package com.pablovillamed.selfcontrol.domain

import com.pablovillamed.selfcontrol.data.AppState
import com.pablovillamed.selfcontrol.data.DayLog
import com.pablovillamed.selfcontrol.data.GoalSettings
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.temporal.TemporalAdjusters

enum class Habit { READING, WATER, WORKOUT }

/** Las semanas empiezan el lunes. */
fun LocalDate.weekStart(): LocalDate = with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))

fun DayLog.amount(habit: Habit) = when (habit) {
    Habit.READING -> pages
    Habit.WATER -> glasses
    Habit.WORKOUT -> workouts
}

/** Cuánto hay que registrar en un día para que cuente como cumplido. */
fun GoalSettings.dailyTarget(habit: Habit) = when (habit) {
    Habit.READING -> pagesPerDay
    Habit.WATER -> glassesPerDay
    Habit.WORKOUT -> 1
}

fun DayLog.meets(habit: Habit, goals: GoalSettings) = amount(habit) >= goals.dailyTarget(habit)

data class GoalProgress(val current: Int, val required: Int) {
    val done get() = current >= required
    val remaining get() = (required - current).coerceAtLeast(0)
    val fraction get() = if (required <= 0) 1f else (current.toFloat() / required).coerceIn(0f, 1f)
}

data class WeekReport(
    val weekStart: LocalDate,
    val goals: GoalSettings,
    val days: List<Pair<LocalDate, DayLog>>,
    /** Días con la meta de lectura cumplida. */
    val reading: GoalProgress,
    /** Días con la meta de agua cumplida. */
    val water: GoalProgress,
    /** Entrenamientos de fuerza acumulados en la semana. */
    val workouts: GoalProgress,
    val sessionsUsed: Int,
    /** Primer día en que todas las metas quedaron cumplidas, o null si la semana sigue bloqueada. */
    val unlockedOn: LocalDate?,
) {
    val unlocked get() = unlockedOn != null
    val overall get() = (reading.fraction + water.fraction + workouts.fraction) / 3f
    val sessionsLeft get() = if (unlocked) (goals.maxSessionsPerWeek - sessionsUsed).coerceAtLeast(0) else 0
    val unlockedEarly get() = unlockedOn != null && unlockedOn <= weekStart.plusDays(1)

    fun progress(habit: Habit) = when (habit) {
        Habit.READING -> reading
        Habit.WATER -> water
        Habit.WORKOUT -> workouts
    }
}

data class LevelInfo(val level: Int, val title: String, val xp: Int, val levelStartXp: Int, val nextLevelXp: Int) {
    val fraction get() = ((xp - levelStartXp).toFloat() / (nextLevelXp - levelStartXp)).coerceIn(0f, 1f)
    val xpToNext get() = nextLevelXp - xp
}

data class Totals(val pages: Int, val glasses: Int, val workouts: Int, val completedWeeks: Int, val sessions: Int)

/** Reglas del juego, calculadas siempre a partir del estado guardado. */
class GameEngine(private val state: AppState) {

    private val weekCache = HashMap<LocalDate, WeekReport>()

    fun goalsFor(weekStart: LocalDate): GoalSettings {
        val key = weekStart.toString()
        val history = state.goalHistory
        return history.filterKeys { it <= key }.maxByOrNull { it.key }?.value
            ?: history.minByOrNull { it.key }?.value
            ?: GoalSettings()
    }

    fun log(date: LocalDate): DayLog = state.logs[date.toString()] ?: DayLog()

    fun week(weekStart: LocalDate): WeekReport = weekCache.getOrPut(weekStart) { buildWeek(weekStart) }

    private fun buildWeek(weekStart: LocalDate): WeekReport {
        val goals = goalsFor(weekStart)
        val days = (0L until 7L).map { weekStart.plusDays(it).let { d -> d to log(d) } }

        var readingDays = 0
        var waterDays = 0
        var workouts = 0
        var unlockedOn: LocalDate? = null
        for ((date, log) in days) {
            if (log.meets(Habit.READING, goals)) readingDays++
            if (log.meets(Habit.WATER, goals)) waterDays++
            workouts += log.workouts
            val allDone = readingDays >= goals.readingDays &&
                waterDays >= goals.waterDays &&
                workouts >= goals.workoutsPerWeek
            if (allDone && unlockedOn == null) unlockedOn = date
        }

        return WeekReport(
            weekStart = weekStart,
            goals = goals,
            days = days,
            reading = GoalProgress(readingDays, goals.readingDays),
            water = GoalProgress(waterDays, goals.waterDays),
            workouts = GoalProgress(workouts, goals.workoutsPerWeek),
            sessionsUsed = sessionsIn(weekStart),
            unlockedOn = unlockedOn,
        )
    }

    fun sessionsIn(weekStart: LocalDate) =
        state.sessions.count { LocalDateTime.parse(it).toLocalDate().weekStart() == weekStart }

    /** Semanas desde la primera actividad registrada hasta la semana de [today], en orden. */
    fun weeksUntil(today: LocalDate): List<LocalDate> {
        val current = today.weekStart()
        val first = state.logs.keys.minOrNull()?.let { LocalDate.parse(it).weekStart() } ?: current
        return generateSequence(first) { it.plusWeeks(1) }.takeWhile { it <= current }.toList()
    }

    fun xp(today: LocalDate): Int {
        var xp = 0
        for ((key, log) in state.logs) {
            val date = LocalDate.parse(key)
            if (date > today) continue
            val goals = goalsFor(date.weekStart())
            xp += log.pages * XP_PER_PAGE + log.glasses * XP_PER_GLASS + log.workouts * XP_PER_WORKOUT
            if (log.meets(Habit.READING, goals)) xp += XP_DAILY_TARGET
            if (log.meets(Habit.WATER, goals)) xp += XP_DAILY_TARGET
        }
        xp += weeksUntil(today).count { week(it).unlocked } * XP_WEEK_COMPLETED
        return xp
    }

    /** Semanas cumplidas seguidas. La semana en curso solo suma cuando ya está cumplida; nunca rompe la racha. */
    fun streak(today: LocalDate): Int {
        var cursor = today.weekStart()
        if (!week(cursor).unlocked) cursor = cursor.minusWeeks(1)
        var count = 0
        while (week(cursor).unlocked) {
            count++
            cursor = cursor.minusWeeks(1)
        }
        return count
    }

    fun bestStreak(today: LocalDate): Int {
        var best = 0
        var run = 0
        for (start in weeksUntil(today)) {
            run = if (week(start).unlocked) run + 1 else 0
            best = maxOf(best, run)
        }
        return best
    }

    fun totals(today: LocalDate): Totals {
        val logs = state.logs.values
        return Totals(
            pages = logs.sumOf { it.pages },
            glasses = logs.sumOf { it.glasses },
            workouts = logs.sumOf { it.workouts },
            completedWeeks = weeksUntil(today).count { week(it).unlocked },
            sessions = state.sessions.size,
        )
    }

    fun badges(today: LocalDate): List<BadgeProgress> {
        val totals = totals(today)
        val currentWeek = today.weekStart()
        val weeks = weeksUntil(today).map(::week)
        val best = bestStreak(today)
        return Badge.entries.map { badge ->
            val current = when (badge) {
                Badge.FIRST_STEP -> if (state.logs.values.any { !it.isEmpty }) 1 else 0
                Badge.BOOKWORM, Badge.AVID_READER -> totals.pages
                Badge.HYDRATED -> totals.glasses
                Badge.IRON_WILL, Badge.TITAN -> totals.workouts
                Badge.EMERALD_WEEK -> totals.completedWeeks
                Badge.DISCIPLINE -> weeks.count { it.unlockedEarly }
                Badge.CONSISTENCY, Badge.UNSTOPPABLE -> best
                // Solo cuentan semanas ya cerradas: la actual aún podría tener sesiones.
                Badge.MINDFUL_PAUSE -> weeks.count { it.weekStart < currentWeek && it.unlocked && it.sessionsUsed == 0 }
                Badge.FULL_BLOOM -> level(xp(today)).level
            }
            BadgeProgress(badge, current.coerceAtMost(badge.target), badge.target)
        }
    }

    companion object {
        const val XP_PER_PAGE = 1
        const val XP_PER_GLASS = 2
        const val XP_PER_WORKOUT = 20
        const val XP_DAILY_TARGET = 10
        const val XP_WEEK_COMPLETED = 100

        private val LEVEL_TITLES = listOf(
            "Semilla", "Germinado", "Plántula", "Crecimiento",
            "Prefloración", "Floración", "Cosecha", "Maestro Esmeralda",
        )

        /** XP mínima para alcanzar el nivel [level] (1, 150, 450, 900, 1500...). */
        fun levelThreshold(level: Int) = 75 * level * (level - 1)

        fun level(xp: Int): LevelInfo {
            var level = 1
            while (xp >= levelThreshold(level + 1)) level++
            return LevelInfo(
                level = level,
                title = LEVEL_TITLES[(level - 1).coerceAtMost(LEVEL_TITLES.lastIndex)],
                xp = xp,
                levelStartXp = levelThreshold(level),
                nextLevelXp = levelThreshold(level + 1),
            )
        }
    }
}

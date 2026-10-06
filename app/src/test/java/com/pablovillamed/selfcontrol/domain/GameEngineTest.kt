package com.pablovillamed.selfcontrol.domain

import com.pablovillamed.selfcontrol.data.AppState
import com.pablovillamed.selfcontrol.data.DayLog
import com.pablovillamed.selfcontrol.data.GoalSettings
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.LocalDateTime

class GameEngineTest {

    // Lunes 5 de octubre de 2026.
    private val monday = LocalDate.of(2026, 10, 5)
    private val tuesday = monday.plusDays(1)
    private val friday = monday.plusDays(4)

    private val goals = GoalSettings()

    private fun stateWith(vararg logs: Pair<LocalDate, DayLog>, sessions: List<String> = emptyList()) = AppState(
        ageVerified = true,
        goalHistory = mapOf(monday.toString() to goals),
        logs = logs.associate { (date, log) -> date.toString() to log },
        sessions = sessions,
    )

    /** Dos días cumpliendo lectura y agua, con un entrenamiento cada día: desbloquea el martes. */
    private fun unlockedWeek(start: LocalDate = monday) = arrayOf(
        start to DayLog(pages = 10, glasses = 7, workouts = 1),
        start.plusDays(1) to DayLog(pages = 12, glasses = 8, workouts = 1),
    )

    @Test
    fun `weeks start on monday`() {
        assertEquals(monday, LocalDate.of(2026, 10, 11).weekStart())
        assertEquals(monday, monday.weekStart())
        assertEquals(monday, tuesday.weekStart())
    }

    @Test
    fun `week stays locked until every goal is met`() {
        val state = stateWith(
            monday to DayLog(pages = 10, glasses = 7, workouts = 1),
            tuesday to DayLog(pages = 9, glasses = 7, workouts = 1),
        )
        val week = GameEngine(state).week(monday)

        assertFalse(week.unlocked)
        assertEquals(1, week.reading.current)
        assertEquals(2, week.water.current)
        assertEquals(2, week.workouts.current)
        assertEquals(0, week.sessionsLeft)
    }

    @Test
    fun `meeting every goal in the first two days unlocks early`() {
        val week = GameEngine(stateWith(*unlockedWeek())).week(monday)

        assertTrue(week.unlocked)
        assertEquals(tuesday, week.unlockedOn)
        assertTrue(week.unlockedEarly)
        assertEquals(goals.maxSessionsPerWeek, week.sessionsLeft)
        assertEquals(1f, week.overall)
    }

    @Test
    fun `unlocking later in the week is not early`() {
        val state = stateWith(
            monday to DayLog(pages = 10, glasses = 7),
            tuesday to DayLog(pages = 10, glasses = 7),
            friday to DayLog(workouts = 2),
        )
        val week = GameEngine(state).week(monday)

        assertEquals(friday, week.unlockedOn)
        assertFalse(week.unlockedEarly)
    }

    @Test
    fun `sessions are limited per week`() {
        var state = stateWith(*unlockedWeek())
        val now = LocalDateTime.of(tuesday, java.time.LocalTime.of(21, 0))
        repeat(goals.maxSessionsPerWeek + 2) { state = Actions.logSession(state, now) }

        assertEquals(goals.maxSessionsPerWeek, state.sessions.size)
        assertEquals(0, GameEngine(state).week(monday).sessionsLeft)
    }

    @Test
    fun `sessions cannot be logged while locked`() {
        val state = stateWith(monday to DayLog(pages = 10))
        val after = Actions.logSession(state, LocalDateTime.of(monday, java.time.LocalTime.NOON))

        assertSame(state, after)
    }

    @Test
    fun `only today's last session can be undone`() {
        val state = stateWith(*unlockedWeek(), sessions = listOf("2026-10-06T21:00:00"))

        assertTrue(Actions.undoLastSession(state, tuesday).sessions.isEmpty())
        assertEquals(1, Actions.undoLastSession(state, friday).sessions.size)
    }

    @Test
    fun `adjust only edits past days of the current week`() {
        val state = stateWith()

        val edited = Actions.adjust(state, monday, tuesday, Habit.READING, 5)
        assertEquals(5, edited.logs[monday.toString()]?.pages)

        assertSame(state, Actions.adjust(state, friday, tuesday, Habit.READING, 5))
        assertSame(state, Actions.adjust(state, monday.minusDays(1), tuesday, Habit.READING, 5))
    }

    @Test
    fun `adjust never goes below zero and drops empty days`() {
        val state = stateWith(monday to DayLog(glasses = 1))
        val after = Actions.adjust(state, monday, monday, Habit.WATER, -3)

        assertNull(after.logs[monday.toString()])
    }

    @Test
    fun `goal changes apply from next monday`() {
        val state = stateWith()
        val tougher = goals.copy(pagesPerDay = 20)
        val scheduled = Actions.scheduleGoals(state, tougher, tuesday)
        val engine = GameEngine(scheduled)

        assertEquals(goals, engine.goalsFor(monday))
        assertEquals(tougher, engine.goalsFor(monday.plusWeeks(1)))
        assertEquals(tougher, engine.goalsFor(monday.plusWeeks(5)))
    }

    @Test
    fun `scheduling the current goals cancels a pending change`() {
        val pending = Actions.scheduleGoals(stateWith(), goals.copy(pagesPerDay = 20), tuesday)
        val cancelled = Actions.scheduleGoals(pending, goals, tuesday)

        assertFalse(cancelled.goalHistory.containsKey(monday.plusWeeks(1).toString()))
    }

    @Test
    fun `streak counts consecutive completed weeks and ignores the week in progress`() {
        val lastWeek = monday.minusWeeks(1)
        val twoWeeksAgo = monday.minusWeeks(2)
        val state = stateWith(*unlockedWeek(twoWeeksAgo), *unlockedWeek(lastWeek), monday to DayLog(pages = 3))
        val engine = GameEngine(state)

        assertEquals(2, engine.streak(tuesday))
        assertEquals(2, engine.bestStreak(tuesday))

        val completed = GameEngine(state.copy(logs = state.logs + unlockedWeek().associate { it.first.toString() to it.second }))
        assertEquals(3, completed.streak(tuesday))
    }

    @Test
    fun `missing a week breaks the streak`() {
        val state = stateWith(*unlockedWeek(monday.minusWeeks(3)), *unlockedWeek(monday.minusWeeks(1)))
        val engine = GameEngine(state)

        assertEquals(1, engine.streak(tuesday))
        assertEquals(1, engine.bestStreak(tuesday))
    }

    @Test
    fun `xp adds activity, daily targets and completed weeks`() {
        val state = stateWith(monday to DayLog(pages = 10, glasses = 7, workouts = 1))
        // 10 páginas + 7 vasos × 2 + 1 entreno × 20 + 2 metas diarias × 10
        assertEquals(10 + 14 + 20 + 20, GameEngine(state).xp(monday))

        val full = GameEngine(stateWith(*unlockedWeek()))
        // Lunes: 64. Martes: 12 + 16 + 20 + 20 = 68. Semana desbloqueada: 100.
        assertEquals(64 + 68 + 100, full.xp(tuesday))
    }

    @Test
    fun `levels follow growing thresholds`() {
        assertEquals(1, GameEngine.level(0).level)
        assertEquals(1, GameEngine.level(149).level)
        assertEquals(2, GameEngine.level(150).level)
        assertEquals(3, GameEngine.level(450).level)
        assertEquals("Plántula", GameEngine.level(450).title)
        assertEquals("Maestro Esmeralda", GameEngine.level(100_000).title)
        assertEquals(0.5f, GameEngine.level(300).fraction)
    }

    @Test
    fun `mindful pause only counts closed weeks without sessions`() {
        val lastWeek = monday.minusWeeks(1)
        val state = stateWith(*unlockedWeek(lastWeek), *unlockedWeek())
        val badges = GameEngine(state).badges(tuesday).associateBy { it.badge }

        assertTrue(badges.getValue(Badge.MINDFUL_PAUSE).earned)
        assertEquals(1, badges.getValue(Badge.MINDFUL_PAUSE).current)
        assertTrue(badges.getValue(Badge.DISCIPLINE).earned)
        assertTrue(badges.getValue(Badge.EMERALD_WEEK).earned)
        assertTrue(badges.getValue(Badge.FIRST_STEP).earned)
        assertFalse(badges.getValue(Badge.BOOKWORM).earned)
    }

    @Test
    fun `goal settings are clamped to sane ranges`() {
        val clean = GoalSettings(pagesPerDay = 0, readingDays = 9, workoutsPerWeek = -1).sanitized()

        assertEquals(1, clean.pagesPerDay)
        assertEquals(7, clean.readingDays)
        assertEquals(1, clean.workoutsPerWeek)
    }
}

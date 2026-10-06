package com.pablovillamed.selfcontrol.domain

import com.pablovillamed.selfcontrol.data.AppState
import com.pablovillamed.selfcontrol.data.DayLog
import com.pablovillamed.selfcontrol.data.GoalSettings
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.temporal.ChronoUnit

/** Transiciones de estado. Las que no están permitidas devuelven el estado sin cambios. */
object Actions {

    private val maxPerDay = mapOf(Habit.READING to 2000, Habit.WATER to 40, Habit.WORKOUT to 3)

    fun completeOnboarding(state: AppState, goals: GoalSettings, today: LocalDate) = state.copy(
        ageVerified = true,
        goalHistory = state.goalHistory + (today.weekStart().toString() to goals.sanitized()),
    )

    /** Solo se pueden editar los días ya transcurridos de la semana en curso. */
    fun canEdit(date: LocalDate, today: LocalDate) = date.weekStart() == today.weekStart() && date <= today

    fun adjust(state: AppState, date: LocalDate, today: LocalDate, habit: Habit, delta: Int): AppState {
        if (!canEdit(date, today)) return state
        val key = date.toString()
        val log = state.logs[key] ?: DayLog()
        val value = (log.amount(habit) + delta).coerceIn(0, maxPerDay.getValue(habit))
        val updated = when (habit) {
            Habit.READING -> log.copy(pages = value)
            Habit.WATER -> log.copy(glasses = value)
            Habit.WORKOUT -> log.copy(workouts = value)
        }
        val logs = if (updated.isEmpty) state.logs - key else state.logs + (key to updated)
        return state.copy(logs = logs)
    }

    fun logSession(state: AppState, now: LocalDateTime): AppState {
        val week = GameEngine(state).week(now.toLocalDate().weekStart())
        if (week.sessionsLeft <= 0) return state
        return state.copy(sessions = state.sessions + now.truncatedTo(ChronoUnit.SECONDS).toString())
    }

    /** Deshace la última sesión si se registró hoy (para corregir un toque accidental). */
    fun undoLastSession(state: AppState, today: LocalDate): AppState {
        val last = state.sessions.lastOrNull() ?: return state
        if (LocalDateTime.parse(last).toLocalDate() != today) return state
        return state.copy(sessions = state.sessions.dropLast(1))
    }

    /**
     * Los cambios de metas entran en vigor el lunes siguiente, así nadie baja el listón
     * a mitad de semana para desbloquear antes de tiempo.
     */
    fun scheduleGoals(state: AppState, goals: GoalSettings, today: LocalDate): AppState {
        val nextWeek = today.weekStart().plusWeeks(1)
        val key = nextWeek.toString()
        val clean = goals.sanitized()
        val withoutPending = state.copy(goalHistory = state.goalHistory - key)
        return if (GameEngine(withoutPending).goalsFor(nextWeek) == clean) {
            withoutPending
        } else {
            state.copy(goalHistory = state.goalHistory + (key to clean))
        }
    }
}

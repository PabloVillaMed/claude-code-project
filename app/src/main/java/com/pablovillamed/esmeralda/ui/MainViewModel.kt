package com.pablovillamed.esmeralda.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.pablovillamed.esmeralda.data.AppRepository
import com.pablovillamed.esmeralda.data.AppState
import com.pablovillamed.esmeralda.data.DayLog
import com.pablovillamed.esmeralda.data.GoalSettings
import com.pablovillamed.esmeralda.domain.Actions
import com.pablovillamed.esmeralda.domain.Affirmations
import com.pablovillamed.esmeralda.domain.BadgeProgress
import com.pablovillamed.esmeralda.domain.GameEngine
import com.pablovillamed.esmeralda.domain.Habit
import com.pablovillamed.esmeralda.domain.LevelInfo
import com.pablovillamed.esmeralda.domain.ResponsibleUse
import com.pablovillamed.esmeralda.domain.Totals
import com.pablovillamed.esmeralda.domain.WeekReport
import com.pablovillamed.esmeralda.domain.weekStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.LocalDateTime
import kotlin.time.Duration.Companion.seconds

data class UiState(
    val today: LocalDate,
    val ageVerified: Boolean,
    val week: WeekReport,
    val pastWeeks: List<WeekReport>,
    /** Metas programadas para el lunes siguiente, si difieren de las actuales. */
    val pendingGoals: GoalSettings?,
    val level: LevelInfo,
    val streak: Int,
    val bestStreak: Int,
    val totals: Totals,
    val badges: List<BadgeProgress>,
    val canUndoSession: Boolean,
    val affirmation: String,
    val tip: String,
) {
    val todayLog: DayLog get() = log(today)
    fun log(date: LocalDate): DayLog = week.days.firstOrNull { it.first == date }?.second ?: DayLog()
}

/** Lo que la interfaz puede pedir que cambie. */
interface AppActions {
    fun completeOnboarding(goals: GoalSettings)
    fun adjust(date: LocalDate, habit: Habit, delta: Int)
    fun logSession()
    fun undoSession()
    fun scheduleGoals(goals: GoalSettings)
    fun resetAll()
}

class MainViewModel(app: Application) : AndroidViewModel(app), AppActions {

    private val repo = AppRepository(app)

    /** Emite la fecha actual y vuelve a emitir al cambiar de día con la app abierta. */
    private val today = flow {
        while (true) {
            emit(LocalDate.now())
            delay(30.seconds)
        }
    }.distinctUntilChanged()

    val ui: StateFlow<UiState?> = combine(repo.state, today) { state, today -> state.toUiState(today) }
        .flowOn(Dispatchers.Default)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    override fun completeOnboarding(goals: GoalSettings) = mutate { state, today ->
        Actions.completeOnboarding(state, goals, today)
    }

    override fun adjust(date: LocalDate, habit: Habit, delta: Int) = mutate { state, today ->
        Actions.adjust(state, date, today, habit, delta)
    }

    override fun logSession() = mutate { state, _ -> Actions.logSession(state, LocalDateTime.now()) }

    override fun undoSession() = mutate { state, today -> Actions.undoLastSession(state, today) }

    override fun scheduleGoals(goals: GoalSettings) = mutate { state, today ->
        Actions.scheduleGoals(state, goals, today)
    }

    override fun resetAll() = mutate { _, _ -> AppState() }

    private fun mutate(block: (AppState, LocalDate) -> AppState) {
        viewModelScope.launch { repo.update { block(it, LocalDate.now()) } }
    }
}

fun AppState.toUiState(today: LocalDate): UiState {
    val engine = GameEngine(this)
    val currentWeek = today.weekStart()
    val nextWeek = currentWeek.plusWeeks(1)
    val pastWeeks = engine.weeksUntil(today)
        .filter { it < currentWeek }
        .takeLast(8)
        .reversed()
        .map(engine::week)
    val lastSession = sessions.lastOrNull()?.let(LocalDateTime::parse)

    return UiState(
        today = today,
        ageVerified = ageVerified,
        week = engine.week(currentWeek),
        pastWeeks = pastWeeks,
        pendingGoals = goalHistory[nextWeek.toString()],
        level = GameEngine.level(engine.xp(today)),
        streak = engine.streak(today),
        bestStreak = engine.bestStreak(today),
        totals = engine.totals(today),
        badges = engine.badges(today),
        canUndoSession = lastSession?.toLocalDate() == today,
        affirmation = Affirmations.forDate(today),
        tip = ResponsibleUse.forDate(today),
    )
}

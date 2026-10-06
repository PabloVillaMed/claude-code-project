package com.pablovillamed.selfcontrol

import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.annotation.DrawableRes
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Snackbar
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.pablovillamed.selfcontrol.domain.Badge
import com.pablovillamed.selfcontrol.ui.AppActions
import com.pablovillamed.selfcontrol.ui.MainViewModel
import com.pablovillamed.selfcontrol.ui.UiState
import com.pablovillamed.selfcontrol.ui.components.Celebration
import com.pablovillamed.selfcontrol.ui.components.LeafMark
import com.pablovillamed.selfcontrol.ui.components.ScreenBackground
import com.pablovillamed.selfcontrol.ui.screens.AchievementsScreen
import com.pablovillamed.selfcontrol.ui.screens.HomeScreen
import com.pablovillamed.selfcontrol.ui.screens.OnboardingScreen
import com.pablovillamed.selfcontrol.ui.screens.SettingsScreen
import com.pablovillamed.selfcontrol.ui.screens.WeekScreen
import com.pablovillamed.selfcontrol.ui.theme.Emerald
import com.pablovillamed.selfcontrol.ui.theme.EmeraldBright
import com.pablovillamed.selfcontrol.ui.theme.EmeraldInk
import com.pablovillamed.selfcontrol.ui.theme.SelfControlTheme
import com.pablovillamed.selfcontrol.ui.theme.Graphite
import com.pablovillamed.selfcontrol.ui.theme.MatteBlack
import com.pablovillamed.selfcontrol.ui.theme.TextMuted
import kotlinx.coroutines.launch
import java.time.LocalDate

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // La interfaz es siempre oscura, así que los iconos del sistema van siempre en claro.
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
        )
        super.onCreate(savedInstanceState)
        setContent {
            SelfControlTheme {
                SelfControlApp()
            }
        }
    }
}

private enum class Tab(val label: String, @param:DrawableRes val icon: Int) {
    HOME("Inicio", R.drawable.ic_home),
    WEEK("Semana", R.drawable.ic_calendar),
    ACHIEVEMENTS("Logros", R.drawable.ic_trophy),
    SETTINGS("Ajustes", R.drawable.ic_settings),
}

@Composable
private fun SelfControlApp(viewModel: MainViewModel = viewModel()) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    Surface(Modifier.fillMaxSize(), color = MatteBlack) {
        val state = ui
        when {
            state == null -> Box(contentAlignment = Alignment.Center) {
                LeafMark(Modifier.size(96.dp), glow = true)
            }

            !state.ageVerified -> OnboardingScreen(state.today, viewModel::completeOnboarding)
            else -> MainScaffold(state, viewModel)
        }
    }
}

/** Lo que se compara entre dos estados para detectar hitos y celebrarlos. */
private data class Milestones(val weekStart: LocalDate, val unlocked: Boolean, val level: Int, val badges: Set<Badge>)

private fun UiState.milestones() = Milestones(
    weekStart = week.weekStart,
    unlocked = week.unlocked,
    level = level.level,
    badges = badges.filter { it.earned }.map { it.badge }.toSet(),
)

@Composable
private fun MainScaffold(ui: UiState, actions: AppActions) {
    var tab by rememberSaveable { mutableStateOf(Tab.HOME) }
    BackHandler(enabled = tab != Tab.HOME) { tab = Tab.HOME }

    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val haptics = LocalHapticFeedback.current
    var celebration by remember { mutableIntStateOf(0) }
    var previous by remember { mutableStateOf<Milestones?>(null) }

    LaunchedEffect(ui) {
        val now = ui.milestones()
        val before = previous
        previous = now
        if (before == null) return@LaunchedEffect
        val messages = buildList {
            if (before.weekStart == now.weekStart && !before.unlocked && now.unlocked) {
                add("¡Semana desbloqueada! Disfruta con responsabilidad.")
            }
            if (now.level > before.level) add("¡Subiste al nivel ${now.level}: ${ui.level.title}!")
            (now.badges - before.badges).forEach { add("Nueva insignia: ${it.title}") }
        }
        if (messages.isNotEmpty()) {
            celebration++
            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
            scope.launch { messages.forEach { snackbar.showSnackbar(it) } }
        }
    }

    Box(Modifier.fillMaxSize()) {
        Scaffold(
            containerColor = MatteBlack,
            snackbarHost = {
                SnackbarHost(snackbar) { data ->
                    Snackbar(
                        data,
                        shape = RoundedCornerShape(18.dp),
                        containerColor = EmeraldInk,
                        contentColor = EmeraldBright,
                    )
                }
            },
            bottomBar = {
                NavigationBar(containerColor = Graphite, tonalElevation = 0.dp) {
                    Tab.entries.forEach { item ->
                        NavigationBarItem(
                            selected = tab == item,
                            onClick = { tab = item },
                            icon = { Icon(painterResource(item.icon), null) },
                            label = { Text(item.label) },
                            colors = NavigationBarItemDefaults.colors(
                                selectedIconColor = MatteBlack,
                                selectedTextColor = Emerald,
                                indicatorColor = Emerald,
                                unselectedIconColor = TextMuted,
                                unselectedTextColor = TextMuted,
                            ),
                        )
                    }
                }
            },
        ) { padding ->
            ScreenBackground {
                AnimatedContent(
                    targetState = tab,
                    modifier = Modifier.padding(padding),
                    transitionSpec = { fadeIn(tween(220)) togetherWith fadeOut(tween(160)) },
                    label = "tabs",
                ) { current ->
                    when (current) {
                        Tab.HOME -> HomeScreen(
                            ui,
                            onAdjust = actions::adjust,
                            onLogSession = actions::logSession,
                            onUndoSession = actions::undoSession,
                        )

                        Tab.WEEK -> WeekScreen(ui, onAdjust = actions::adjust)
                        Tab.ACHIEVEMENTS -> AchievementsScreen(ui)
                        Tab.SETTINGS -> SettingsScreen(
                            ui,
                            onScheduleGoals = actions::scheduleGoals,
                            onReset = actions::resetAll,
                        )
                    }
                }
            }
        }
        Celebration(celebration)
    }
}

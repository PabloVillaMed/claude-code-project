package com.pablovillamed.selfcontrol.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.pablovillamed.selfcontrol.R
import com.pablovillamed.selfcontrol.domain.Badge
import com.pablovillamed.selfcontrol.domain.BadgeProgress
import com.pablovillamed.selfcontrol.domain.GameEngine
import com.pablovillamed.selfcontrol.ui.UiState
import com.pablovillamed.selfcontrol.ui.components.GlowBar
import com.pablovillamed.selfcontrol.ui.components.MatteCard
import com.pablovillamed.selfcontrol.ui.components.ProgressRing
import com.pablovillamed.selfcontrol.ui.components.SectionLabel
import com.pablovillamed.selfcontrol.ui.theme.EmeraldBright
import com.pablovillamed.selfcontrol.ui.theme.EmeraldDeep
import com.pablovillamed.selfcontrol.ui.theme.GraphiteHighest
import com.pablovillamed.selfcontrol.ui.theme.OnEmerald
import com.pablovillamed.selfcontrol.ui.theme.TextFaint
import com.pablovillamed.selfcontrol.ui.theme.TextMuted
import java.text.NumberFormat
import java.util.Locale

private val numbers = NumberFormat.getIntegerInstance(Locale.forLanguageTag("es"))

private val Badge.icon
    get() = when (this) {
        Badge.FIRST_STEP -> R.drawable.ic_star
        Badge.BOOKWORM, Badge.AVID_READER -> R.drawable.ic_book
        Badge.HYDRATED -> R.drawable.ic_drop
        Badge.IRON_WILL, Badge.TITAN -> R.drawable.ic_dumbbell
        Badge.EMERALD_WEEK -> R.drawable.ic_calendar_check
        Badge.DISCIPLINE -> R.drawable.ic_bolt
        Badge.CONSISTENCY, Badge.UNSTOPPABLE -> R.drawable.ic_fire
        Badge.MINDFUL_PAUSE -> R.drawable.ic_pause
        Badge.FULL_BLOOM -> R.drawable.ic_trophy
    }

@Composable
fun AchievementsScreen(ui: UiState) {
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Column {
            SectionLabel("Tu progreso")
            Text("Logros", style = MaterialTheme.typography.headlineMedium)
        }
        LevelCard(ui)
        StatsGrid(ui)
        val earned = ui.badges.count { it.earned }
        SectionLabel("Insignias · $earned de ${ui.badges.size}", Modifier.padding(top = 8.dp, start = 4.dp))
        ui.badges.chunked(2).forEach { pair ->
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                pair.forEach { BadgeTile(it, Modifier.weight(1f)) }
                if (pair.size == 1) Spacer(Modifier.weight(1f))
            }
        }
        XpGuide()
        Spacer(Modifier.height(8.dp))
    }
}

@Composable
private fun LevelCard(ui: UiState) {
    val level = ui.level
    MatteCard(highlighted = true) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            ProgressRing(level.fraction, Modifier.size(118.dp), strokeWidth = 9.dp) {
                Text("${level.level}", style = MaterialTheme.typography.displaySmall, color = EmeraldBright)
            }
            Column(Modifier.padding(start = 16.dp)) {
                SectionLabel("Nivel ${level.level}")
                Text(level.title, style = MaterialTheme.typography.headlineSmall)
                Text("${numbers.format(level.xp)} XP", color = EmeraldBright, style = MaterialTheme.typography.titleMedium)
                Text(
                    "Faltan ${numbers.format(level.xpToNext)} XP para el nivel ${level.level + 1}",
                    color = TextMuted,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
    }
}

@Composable
private fun StatsGrid(ui: UiState) {
    val totals = ui.totals
    val stats = listOf(
        "Páginas" to totals.pages,
        "Vasos" to totals.glasses,
        "Entrenos" to totals.workouts,
        "Semanas" to totals.completedWeeks,
        "Racha" to ui.streak,
        "Mejor racha" to ui.bestStreak,
    )
    stats.chunked(3).forEach { row ->
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            row.forEach { (label, value) ->
                MatteCard(Modifier.weight(1f), contentPadding = PaddingValues(vertical = 16.dp, horizontal = 8.dp)) {
                    Text(
                        numbers.format(value),
                        Modifier.fillMaxWidth(),
                        style = MaterialTheme.typography.headlineSmall,
                        textAlign = TextAlign.Center,
                    )
                    Text(
                        label,
                        Modifier.fillMaxWidth(),
                        style = MaterialTheme.typography.bodySmall,
                        color = TextMuted,
                        textAlign = TextAlign.Center,
                    )
                }
            }
        }
    }
}

@Composable
private fun BadgeTile(progress: BadgeProgress, modifier: Modifier = Modifier) {
    val badge = progress.badge
    MatteCard(modifier, highlighted = progress.earned, contentPadding = PaddingValues(16.dp)) {
        Box(
            Modifier
                .size(56.dp)
                .clip(CircleShape)
                .background(
                    if (progress.earned) Brush.linearGradient(listOf(EmeraldBright, EmeraldDeep))
                    else Brush.linearGradient(listOf(GraphiteHighest, GraphiteHighest)),
                ),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                painterResource(badge.icon), null,
                tint = if (progress.earned) OnEmerald else TextFaint,
                modifier = Modifier.size(28.dp),
            )
        }
        Spacer(Modifier.height(12.dp))
        Text(badge.title, style = MaterialTheme.typography.titleSmall)
        Text(badge.description, style = MaterialTheme.typography.bodySmall, color = TextMuted, minLines = 2)
        Spacer(Modifier.height(10.dp))
        if (progress.earned) {
            Text("Conseguida", style = MaterialTheme.typography.labelSmall, color = EmeraldBright)
        } else {
            GlowBar(progress.fraction, height = 6.dp)
            Spacer(Modifier.height(4.dp))
            Text(
                "${numbers.format(progress.current)} / ${numbers.format(progress.target)}",
                style = MaterialTheme.typography.bodySmall,
                color = TextMuted,
            )
        }
    }
}

@Composable
private fun XpGuide() {
    MatteCard {
        SectionLabel("Cómo ganar XP")
        Spacer(Modifier.height(8.dp))
        listOf(
            "Cada página leída" to GameEngine.XP_PER_PAGE,
            "Cada vaso de agua" to GameEngine.XP_PER_GLASS,
            "Cada entrenamiento de fuerza" to GameEngine.XP_PER_WORKOUT,
            "Cumplir la meta diaria de lectura o agua" to GameEngine.XP_DAILY_TARGET,
            "Desbloquear la semana" to GameEngine.XP_WEEK_COMPLETED,
        ).forEach { (label, xp) ->
            Row(Modifier.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(label, Modifier.weight(1f), color = TextMuted)
                Text("+$xp XP", color = EmeraldBright, style = MaterialTheme.typography.titleSmall)
            }
        }
    }
}

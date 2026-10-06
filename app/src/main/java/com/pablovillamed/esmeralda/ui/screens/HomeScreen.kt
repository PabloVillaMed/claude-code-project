package com.pablovillamed.esmeralda.ui.screens

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.pablovillamed.esmeralda.R
import com.pablovillamed.esmeralda.domain.Habit
import com.pablovillamed.esmeralda.domain.ResponsibleUse
import com.pablovillamed.esmeralda.domain.WeekReport
import com.pablovillamed.esmeralda.domain.meets
import com.pablovillamed.esmeralda.ui.UiState
import com.pablovillamed.esmeralda.ui.components.IconBadge
import com.pablovillamed.esmeralda.ui.components.LeafMark
import com.pablovillamed.esmeralda.ui.components.MatteCard
import com.pablovillamed.esmeralda.ui.components.PillProgress
import com.pablovillamed.esmeralda.ui.components.ProgressRing
import com.pablovillamed.esmeralda.ui.components.QuickChip
import com.pablovillamed.esmeralda.ui.components.RoundIconButton
import com.pablovillamed.esmeralda.ui.components.SectionLabel
import com.pablovillamed.esmeralda.ui.components.StatChip
import com.pablovillamed.esmeralda.ui.icon
import com.pablovillamed.esmeralda.ui.label
import com.pablovillamed.esmeralda.ui.longLabel
import com.pablovillamed.esmeralda.ui.missingText
import com.pablovillamed.esmeralda.ui.plural
import com.pablovillamed.esmeralda.ui.theme.Emerald
import com.pablovillamed.esmeralda.ui.theme.EmeraldBright
import com.pablovillamed.esmeralda.ui.theme.GraphiteHigh
import com.pablovillamed.esmeralda.ui.theme.OnEmerald
import com.pablovillamed.esmeralda.ui.theme.TextFaint
import com.pablovillamed.esmeralda.ui.theme.TextMuted
import com.pablovillamed.esmeralda.ui.theme.TextPrimary
import com.pablovillamed.esmeralda.ui.weekRange
import java.time.LocalDate
import kotlin.math.roundToInt

@Composable
fun HomeScreen(
    ui: UiState,
    onAdjust: (LocalDate, Habit, Int) -> Unit,
    onLogSession: () -> Unit,
    onUndoSession: () -> Unit,
) {
    val adjustToday = { habit: Habit, delta: Int -> onAdjust(ui.today, habit, delta) }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Header(ui)
        HeroCard(ui, onLogSession, onUndoSession)
        SectionLabel("Metas de hoy", Modifier.padding(top = 8.dp, start = 4.dp))
        ReadingCard(ui, adjustToday)
        WaterCard(ui, adjustToday)
        WorkoutCard(ui, adjustToday)
        AffirmationCard(ui.affirmation)
        TipCard(ui.tip)
        Spacer(Modifier.height(8.dp))
    }
}

@Composable
private fun Header(ui: UiState) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            SectionLabel("Esmeralda")
            Text(ui.today.longLabel(), style = MaterialTheme.typography.headlineSmall)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            StatChip(R.drawable.ic_fire, "${ui.streak}")
            StatChip(R.drawable.ic_bolt, "Nv ${ui.level.level}")
        }
    }
}

@Composable
private fun HeroCard(ui: UiState, onLogSession: () -> Unit, onUndoSession: () -> Unit) {
    val week = ui.week
    var confirmSession by rememberSaveable { mutableStateOf(false) }

    MatteCard(highlighted = week.unlocked) {
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
            SectionLabel("Semana ${weekRange(week.weekStart)}")
            Spacer(Modifier.height(8.dp))
            ProgressRing(week.overall, Modifier.size(236.dp)) {
                AnimatedContent(
                    targetState = week.unlocked,
                    transitionSpec = { fadeIn(tween(500)) togetherWith fadeOut(tween(300)) },
                    label = "lock",
                ) { unlocked ->
                    if (unlocked) UnlockedCenter() else LockedCenter(week.overall)
                }
            }
            GoalSummaryRow(week)
            Spacer(Modifier.height(16.dp))
            when {
                !week.unlocked -> {
                    Text("Consumo bloqueado", style = MaterialTheme.typography.titleLarge)
                    Text(
                        "Te falta: ${week.missingText()}",
                        color = TextMuted,
                        textAlign = TextAlign.Center,
                    )
                }

                week.sessionsLeft > 0 -> {
                    Text("Consumo habilitado", style = MaterialTheme.typography.titleLarge, color = EmeraldBright)
                    Text(
                        "Te quedan ${plural(week.sessionsLeft, "sesión", "sesiones")} de " +
                            "${week.goals.maxSessionsPerWeek} esta semana",
                        color = TextMuted,
                        textAlign = TextAlign.Center,
                    )
                    Spacer(Modifier.height(14.dp))
                    Button(
                        onClick = { confirmSession = true },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(54.dp),
                        shape = RoundedCornerShape(18.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = Emerald, contentColor = OnEmerald),
                    ) {
                        Icon(painterResource(R.drawable.ic_lock_open), null, Modifier.size(20.dp))
                        Spacer(Modifier.width(8.dp))
                        Text("Registrar sesión", style = MaterialTheme.typography.titleMedium)
                    }
                }

                else -> {
                    Text("Límite semanal alcanzado", style = MaterialTheme.typography.titleLarge)
                    Text(
                        "Gran autocontrol. El lunes empieza una semana nueva.",
                        color = TextMuted,
                        textAlign = TextAlign.Center,
                    )
                }
            }
            if (ui.canUndoSession) {
                TextButton(onClick = onUndoSession) {
                    Icon(painterResource(R.drawable.ic_undo), null, Modifier.size(18.dp), tint = TextMuted)
                    Spacer(Modifier.width(6.dp))
                    Text("Deshacer la sesión de hoy", color = TextMuted)
                }
            }
        }
    }

    if (confirmSession) {
        AlertDialog(
            onDismissRequest = { confirmSession = false },
            containerColor = GraphiteHigh,
            icon = { LeafMark(Modifier.size(48.dp)) },
            title = { Text("¿Registrar una sesión?") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("Antes de empezar, recuerda:", color = TextMuted)
                    ResponsibleUse.tips.take(4).forEach { Text("•  $it", color = TextPrimary) }
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    confirmSession = false
                    onLogSession()
                }) { Text("Registrar", color = Emerald, fontWeight = FontWeight.Bold) }
            },
            dismissButton = {
                TextButton(onClick = { confirmSession = false }) { Text("Ahora no", color = TextMuted) }
            },
        )
    }
}

@Composable
private fun UnlockedCenter() {
    val pulse by rememberInfiniteTransition(label = "pulse").animateFloat(
        initialValue = 0.94f,
        targetValue = 1.06f,
        animationSpec = infiniteRepeatable(tween(1400), RepeatMode.Reverse),
        label = "pulseScale",
    )
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        LeafMark(
            Modifier
                .size(118.dp)
                .graphicsLayer {
                    scaleX = pulse
                    scaleY = pulse
                },
            glow = true,
        )
        Text("DESBLOQUEADO", style = MaterialTheme.typography.labelSmall, color = EmeraldBright)
    }
}

@Composable
private fun LockedCenter(progress: Float) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Icon(painterResource(R.drawable.ic_lock), null, tint = TextMuted, modifier = Modifier.size(26.dp))
        Text("${(progress * 100).roundToInt()}%", style = MaterialTheme.typography.displayMedium)
        Text("de tu semana", color = TextMuted)
    }
}

@Composable
private fun GoalSummaryRow(week: WeekReport) {
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceEvenly,
    ) {
        Habit.entries.forEach { habit ->
            val progress = week.progress(habit)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    painterResource(if (progress.done) R.drawable.ic_check else habit.icon), null,
                    tint = if (progress.done) Emerald else TextMuted,
                    modifier = Modifier.size(18.dp),
                )
                Spacer(Modifier.width(6.dp))
                Text(
                    "${progress.current.coerceAtMost(progress.required)}/${progress.required}",
                    color = if (progress.done) EmeraldBright else TextPrimary,
                    fontWeight = FontWeight.Bold,
                )
            }
        }
    }
}

@Composable
private fun HabitCard(
    ui: UiState,
    habit: Habit,
    subtitle: String,
    value: Int,
    unit: String,
    doneToday: Boolean,
    content: @Composable () -> Unit,
) {
    val progress = ui.week.progress(habit)
    MatteCard(highlighted = progress.done) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconBadge(habit.icon)
            Column(
                Modifier
                    .weight(1f)
                    .padding(horizontal = 14.dp),
            ) {
                Text(habit.label, style = MaterialTheme.typography.titleMedium)
                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = TextMuted)
            }
            Column(horizontalAlignment = Alignment.End) {
                Text("$value", style = MaterialTheme.typography.headlineMedium, color = if (doneToday) EmeraldBright else TextPrimary)
                Text(unit, style = MaterialTheme.typography.bodySmall, color = TextMuted)
            }
        }
        Spacer(Modifier.height(14.dp))
        PillProgress(progress.current, progress.required)
        Spacer(Modifier.height(14.dp))
        content()
    }
}

@Composable
private fun ReadingCard(ui: UiState, adjust: (Habit, Int) -> Unit) {
    val goals = ui.week.goals
    val pages = ui.todayLog.pages
    val progress = ui.week.reading
    HabitCard(
        ui, Habit.READING,
        subtitle = "${goals.pagesPerDay} págs/día · ${progress.current} de ${progress.required} días",
        value = pages,
        unit = "págs hoy",
        doneToday = ui.todayLog.meets(Habit.READING, goals),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            RoundIconButton(R.drawable.ic_remove, "Restar página", { adjust(Habit.READING, -1) }, enabled = pages > 0)
            RoundIconButton(R.drawable.ic_add, "Sumar página", { adjust(Habit.READING, 1) }, filled = true)
            QuickChip("+5", { adjust(Habit.READING, 5) })
            QuickChip("+10", { adjust(Habit.READING, 10) })
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun WaterCard(ui: UiState, adjust: (Habit, Int) -> Unit) {
    val goals = ui.week.goals
    val glasses = ui.todayLog.glasses
    val progress = ui.week.water
    HabitCard(
        ui, Habit.WATER,
        subtitle = "${goals.glassesPerDay} vasos/día · ${progress.current} de ${progress.required} días",
        value = glasses,
        unit = "vasos hoy",
        doneToday = ui.todayLog.meets(Habit.WATER, goals),
    ) {
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            repeat(maxOf(goals.glassesPerDay, glasses)) { index ->
                Icon(
                    painterResource(R.drawable.ic_drop), null,
                    tint = if (index < glasses) Emerald else TextFaint,
                    modifier = Modifier.size(22.dp),
                )
            }
        }
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            RoundIconButton(R.drawable.ic_remove, "Restar vaso", { adjust(Habit.WATER, -1) }, enabled = glasses > 0)
            RoundIconButton(R.drawable.ic_add, "Sumar vaso", { adjust(Habit.WATER, 1) }, filled = true)
            Text("Un vaso ≈ 250 ml", color = TextMuted, style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun WorkoutCard(ui: UiState, adjust: (Habit, Int) -> Unit) {
    val goals = ui.week.goals
    val today = ui.todayLog.workouts
    val progress = ui.week.workouts
    HabitCard(
        ui, Habit.WORKOUT,
        subtitle = "${plural(goals.workoutsPerWeek, "entreno", "entrenos")} por semana",
        value = progress.current,
        unit = "esta semana",
        doneToday = today > 0,
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            RoundIconButton(R.drawable.ic_remove, "Quitar entrenamiento de hoy", { adjust(Habit.WORKOUT, -1) }, enabled = today > 0)
            Button(
                onClick = { adjust(Habit.WORKOUT, 1) },
                enabled = today < 3,
                modifier = Modifier
                    .weight(1f)
                    .height(44.dp),
                shape = RoundedCornerShape(22.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Emerald, contentColor = OnEmerald),
            ) {
                Text(if (today == 0) "Entrené hoy" else "Otro entreno hoy ($today)", fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
private fun AffirmationCard(text: String) {
    MatteCard {
        SectionLabel("Afirmación del día")
        Text("“", style = MaterialTheme.typography.displayLarge, color = Emerald, modifier = Modifier.height(56.dp))
        Text(text, style = MaterialTheme.typography.titleLarge, fontStyle = FontStyle.Italic)
    }
}

@Composable
private fun TipCard(tip: String) {
    MatteCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconBadge(R.drawable.ic_info, size = 40.dp)
            Column(Modifier.padding(start = 14.dp)) {
                SectionLabel("Uso responsable")
                Spacer(Modifier.height(4.dp))
                Text(tip, color = TextPrimary)
            }
        }
    }
}

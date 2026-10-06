package com.pablovillamed.esmeralda.ui.screens

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.pablovillamed.esmeralda.R
import com.pablovillamed.esmeralda.domain.Actions
import com.pablovillamed.esmeralda.domain.Habit
import com.pablovillamed.esmeralda.domain.WeekReport
import com.pablovillamed.esmeralda.domain.amount
import com.pablovillamed.esmeralda.domain.dailyTarget
import com.pablovillamed.esmeralda.ui.UiState
import com.pablovillamed.esmeralda.ui.components.IconBadge
import com.pablovillamed.esmeralda.ui.components.MatteCard
import com.pablovillamed.esmeralda.ui.components.QuickChip
import com.pablovillamed.esmeralda.ui.components.RoundIconButton
import com.pablovillamed.esmeralda.ui.components.SectionLabel
import com.pablovillamed.esmeralda.ui.dayInitials
import com.pablovillamed.esmeralda.ui.icon
import com.pablovillamed.esmeralda.ui.label
import com.pablovillamed.esmeralda.ui.missingText
import com.pablovillamed.esmeralda.ui.plural
import com.pablovillamed.esmeralda.ui.theme.Emerald
import com.pablovillamed.esmeralda.ui.theme.EmeraldBright
import com.pablovillamed.esmeralda.ui.theme.EmeraldInk
import com.pablovillamed.esmeralda.ui.theme.GraphiteHighest
import com.pablovillamed.esmeralda.ui.theme.Hairline
import com.pablovillamed.esmeralda.ui.theme.OnEmerald
import com.pablovillamed.esmeralda.ui.theme.TextFaint
import com.pablovillamed.esmeralda.ui.theme.TextMuted
import com.pablovillamed.esmeralda.ui.weekRange
import com.pablovillamed.esmeralda.ui.weekdayLabel
import java.time.LocalDate
import kotlin.math.roundToInt

@Composable
fun WeekScreen(ui: UiState, onAdjust: (LocalDate, Habit, Int) -> Unit) {
    var selectedKey by rememberSaveable { mutableStateOf(ui.today.toString()) }
    val selected = LocalDate.parse(selectedKey).takeIf { Actions.canEdit(it, ui.today) } ?: ui.today

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Column {
            SectionLabel(weekRange(ui.week.weekStart))
            Text("Tu semana", style = MaterialTheme.typography.headlineMedium)
        }
        MatteCard(contentPadding = PaddingValues(14.dp)) {
            WeekGrid(ui, selected, onSelect = { selectedKey = it.toString() })
        }
        StatusCard(ui.week)
        DayEditor(ui, selected, onAdjust)
        if (ui.pastWeeks.isNotEmpty()) {
            SectionLabel("Historial", Modifier.padding(top = 8.dp, start = 4.dp))
            ui.pastWeeks.forEach { HistoryRow(it) }
        }
        Spacer(Modifier.height(8.dp))
    }
}

@Composable
private fun WeekGrid(ui: UiState, selected: LocalDate, onSelect: (LocalDate) -> Unit) {
    val week = ui.week
    Row(Modifier.fillMaxWidth()) {
        Spacer(Modifier.width(34.dp))
        week.days.forEachIndexed { index, (date, _) ->
            val editable = Actions.canEdit(date, ui.today)
            val isSelected = date == selected
            Column(
                Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(14.dp))
                    .background(if (isSelected) EmeraldInk else Color.Transparent)
                    .clickable(enabled = editable) { onSelect(date) }
                    .padding(vertical = 6.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(dayInitials[index], style = MaterialTheme.typography.labelSmall, color = TextMuted)
                Text(
                    "${date.dayOfMonth}",
                    fontWeight = FontWeight.Bold,
                    color = when {
                        date == ui.today -> EmeraldBright
                        editable -> MaterialTheme.colorScheme.onSurface
                        else -> TextFaint
                    },
                )
            }
        }
    }
    Spacer(Modifier.height(6.dp))
    Habit.entries.forEach { habit ->
        Row(
            Modifier
                .fillMaxWidth()
                .padding(vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(painterResource(habit.icon), habit.label, tint = Emerald, modifier = Modifier.size(22.dp))
            Spacer(Modifier.width(12.dp))
            week.days.forEach { (date, log) ->
                Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                    val target = week.goals.dailyTarget(habit)
                    DayCell(
                        fraction = log.amount(habit).toFloat() / target,
                        future = date > ui.today,
                    )
                }
            }
        }
    }
}

@Composable
private fun DayCell(fraction: Float, future: Boolean) {
    val done = fraction >= 1f
    Box(Modifier.size(30.dp), contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val stroke = 3.dp.toPx()
            when {
                future -> drawCircle(Hairline, radius = 3.dp.toPx())
                done -> drawCircle(Emerald)
                else -> {
                    val inset = stroke / 2
                    val arcSize = Size(size.width - stroke, size.height - stroke)
                    drawArc(GraphiteHighest, 0f, 360f, false, Offset(inset, inset), arcSize, style = Stroke(stroke))
                    if (fraction > 0f) {
                        drawArc(
                            Emerald, -90f, 360f * fraction, false, Offset(inset, inset), arcSize,
                            style = Stroke(stroke, cap = StrokeCap.Round),
                        )
                    }
                }
            }
        }
        if (done) {
            Icon(painterResource(R.drawable.ic_check), null, tint = OnEmerald, modifier = Modifier.size(18.dp))
        }
    }
}

@Composable
private fun StatusCard(week: WeekReport) {
    MatteCard(highlighted = week.unlocked) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconBadge(if (week.unlocked) R.drawable.ic_lock_open else R.drawable.ic_lock, active = week.unlocked)
            Column(Modifier.padding(start = 14.dp)) {
                val unlockedOn = week.unlockedOn
                if (unlockedOn != null) {
                    Text("Desbloqueada el ${unlockedOn.weekdayLabel()}", style = MaterialTheme.typography.titleMedium)
                    Text(
                        if (week.unlockedEarly) "¡En los dos primeros días! Disciplina pura."
                        else "Sesiones usadas: ${week.sessionsUsed} de ${week.goals.maxSessionsPerWeek}",
                        color = TextMuted,
                    )
                } else {
                    Text("Semana bloqueada", style = MaterialTheme.typography.titleMedium)
                    Text("Falta: ${week.missingText()}", color = TextMuted)
                }
            }
        }
    }
}

@Composable
private fun DayEditor(ui: UiState, date: LocalDate, onAdjust: (LocalDate, Habit, Int) -> Unit) {
    val log = ui.log(date)
    MatteCard {
        SectionLabel(if (date == ui.today) "Registro de hoy" else "Registro del ${date.weekdayLabel()}")
        Text(
            "Toca un día de la semana para completar lo que olvidaste registrar.",
            style = MaterialTheme.typography.bodySmall,
            color = TextMuted,
        )
        Spacer(Modifier.height(12.dp))
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Habit.entries.forEach { habit ->
                val value = log.amount(habit)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconBadge(habit.icon, size = 40.dp)
                    Text(
                        habit.label,
                        Modifier
                            .weight(1f)
                            .padding(start = 12.dp),
                        style = MaterialTheme.typography.titleSmall,
                    )
                    if (habit == Habit.READING) {
                        QuickChip("+5", { onAdjust(date, habit, 5) })
                        Spacer(Modifier.width(8.dp))
                    }
                    RoundIconButton(R.drawable.ic_remove, "Restar", { onAdjust(date, habit, -1) }, enabled = value > 0)
                    Text(
                        "$value",
                        Modifier.widthIn(min = 40.dp),
                        style = MaterialTheme.typography.titleLarge,
                        textAlign = TextAlign.Center,
                    )
                    RoundIconButton(R.drawable.ic_add, "Sumar", { onAdjust(date, habit, 1) }, filled = true)
                }
            }
        }
    }
}

@Composable
private fun HistoryRow(week: WeekReport) {
    MatteCard(highlighted = week.unlocked, contentPadding = PaddingValues(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconBadge(if (week.unlocked) R.drawable.ic_check else R.drawable.ic_lock, size = 36.dp, active = week.unlocked)
            Column(
                Modifier
                    .weight(1f)
                    .padding(start = 12.dp),
            ) {
                Text(weekRange(week.weekStart), style = MaterialTheme.typography.titleSmall)
                Text(
                    if (week.unlocked) "Cumplida · ${plural(week.sessionsUsed, "sesión", "sesiones")}" else "Incompleta",
                    style = MaterialTheme.typography.bodySmall,
                    color = TextMuted,
                )
            }
            Text(
                "${(week.overall * 100).roundToInt()}%",
                style = MaterialTheme.typography.titleMedium,
                color = if (week.unlocked) EmeraldBright else TextMuted,
            )
        }
    }
}

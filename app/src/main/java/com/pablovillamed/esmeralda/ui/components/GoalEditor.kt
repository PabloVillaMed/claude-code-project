package com.pablovillamed.esmeralda.ui.components

import androidx.annotation.DrawableRes
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.pablovillamed.esmeralda.R
import com.pablovillamed.esmeralda.data.GoalSettings
import com.pablovillamed.esmeralda.ui.theme.TextMuted

val GoalSettingsSaver = listSaver<GoalSettings, Int>(
    save = {
        listOf(it.pagesPerDay, it.readingDays, it.workoutsPerWeek, it.glassesPerDay, it.waterDays, it.maxSessionsPerWeek)
    },
    restore = { GoalSettings(it[0], it[1], it[2], it[3], it[4], it[5]) },
)

@Composable
fun GoalEditor(goals: GoalSettings, onChange: (GoalSettings) -> Unit, modifier: Modifier = Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(14.dp)) {
        GoalRow(R.drawable.ic_book, "Lectura", "páginas por día", goals.pagesPerDay, 1..200, step = 5) {
            onChange(goals.copy(pagesPerDay = it))
        }
        GoalRow(R.drawable.ic_calendar, "Días de lectura", "por semana", goals.readingDays, 1..7) {
            onChange(goals.copy(readingDays = it))
        }
        GoalRow(R.drawable.ic_dumbbell, "Fuerza", "entrenos por semana", goals.workoutsPerWeek, 1..7) {
            onChange(goals.copy(workoutsPerWeek = it))
        }
        GoalRow(R.drawable.ic_drop, "Agua", "vasos por día", goals.glassesPerDay, 1..20) {
            onChange(goals.copy(glassesPerDay = it))
        }
        GoalRow(R.drawable.ic_calendar, "Días de agua", "por semana", goals.waterDays, 1..7) {
            onChange(goals.copy(waterDays = it))
        }
        GoalRow(R.drawable.ic_lock_open, "Sesiones", "máximo por semana", goals.maxSessionsPerWeek, 1..7) {
            onChange(goals.copy(maxSessionsPerWeek = it))
        }
    }
}

@Composable
private fun GoalRow(
    @DrawableRes icon: Int,
    title: String,
    hint: String,
    value: Int,
    range: IntRange,
    step: Int = 1,
    onValue: (Int) -> Unit,
) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        IconBadge(icon, size = 40.dp)
        Column(
            Modifier
                .weight(1f)
                .padding(horizontal = 12.dp),
        ) {
            Text(title, style = MaterialTheme.typography.titleSmall)
            Text(hint, style = MaterialTheme.typography.bodySmall, color = TextMuted)
        }
        RoundIconButton(
            R.drawable.ic_remove, "Restar", enabled = value > range.first,
            onClick = { onValue(nextDown(value, step, range.first)) },
        )
        Text(
            "$value",
            modifier = Modifier.widthIn(min = 44.dp),
            style = MaterialTheme.typography.titleLarge,
            textAlign = TextAlign.Center,
        )
        RoundIconButton(
            R.drawable.ic_add, "Sumar", enabled = value < range.last, filled = true,
            onClick = { onValue((value + step - value % step).coerceAtMost(range.last)) },
        )
    }
}

/** Baja al múltiplo anterior de [step] (10 → 5, 12 → 10) sin pasar de [min]. */
private fun nextDown(value: Int, step: Int, min: Int): Int {
    val remainder = value % step
    return (value - if (remainder == 0) step else remainder).coerceAtLeast(min)
}

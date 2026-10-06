package com.pablovillamed.esmeralda.ui.screens

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDefaults
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.pablovillamed.esmeralda.data.GoalSettings
import com.pablovillamed.esmeralda.ui.components.GoalEditor
import com.pablovillamed.esmeralda.ui.components.GoalSettingsSaver
import com.pablovillamed.esmeralda.ui.components.LeafMark
import com.pablovillamed.esmeralda.ui.components.MatteCard
import com.pablovillamed.esmeralda.ui.components.ScreenBackground
import com.pablovillamed.esmeralda.ui.components.SectionLabel
import com.pablovillamed.esmeralda.ui.theme.Danger
import com.pablovillamed.esmeralda.ui.theme.Emerald
import com.pablovillamed.esmeralda.ui.theme.EmeraldBright
import com.pablovillamed.esmeralda.ui.theme.GraphiteHigh
import com.pablovillamed.esmeralda.ui.theme.Hairline
import com.pablovillamed.esmeralda.ui.theme.OnEmerald
import com.pablovillamed.esmeralda.ui.theme.TextMuted
import com.pablovillamed.esmeralda.ui.theme.TextPrimary
import java.time.Instant
import java.time.LocalDate
import java.time.Period
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale

const val MINIMUM_AGE = 18

private val birthFormat = DateTimeFormatter.ofPattern("d 'de' MMMM 'de' yyyy", Locale.forLanguageTag("es"))

@Composable
fun OnboardingScreen(today: LocalDate, onFinish: (GoalSettings) -> Unit) {
    var step by rememberSaveable { mutableIntStateOf(0) }
    var goals by rememberSaveable(stateSaver = GoalSettingsSaver) { mutableStateOf(GoalSettings()) }
    // Vive aquí y no en AgeStep para que sobreviva al ir y volver entre pasos.
    var consent by rememberSaveable(stateSaver = ConsentSaver) { mutableStateOf(Consent()) }

    BackHandler(enabled = step == 1) { step = 0 }

    ScreenBackground {
        AnimatedContent(
            targetState = step,
            transitionSpec = { fadeIn() togetherWith fadeOut() },
            label = "onboarding",
        ) { current ->
            Column(
                Modifier
                    .fillMaxSize()
                    .safeDrawingPadding()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 24.dp, vertical = 16.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                if (current == 0) {
                    AgeStep(today, consent, onChange = { consent = it }, onContinue = { step = 1 })
                } else {
                    GoalsStep(goals, onChange = { goals = it }, onBack = { step = 0 }, onStart = { onFinish(goals) })
                }
            }
        }
    }
}

private data class Consent(
    val birthMillis: Long? = null,
    val legal: Boolean = false,
    val responsible: Boolean = false,
)

private val ConsentSaver = listSaver<Consent, Any?>(
    save = { listOf(it.birthMillis, it.legal, it.responsible) },
    restore = { Consent(it[0] as Long?, it[1] as Boolean, it[2] as Boolean) },
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AgeStep(today: LocalDate, consent: Consent, onChange: (Consent) -> Unit, onContinue: () -> Unit) {
    val birthMillis = consent.birthMillis
    var showPicker by rememberSaveable { mutableStateOf(false) }

    val birthDate = birthMillis?.let { Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate() }
    val age = birthDate?.let { Period.between(it, today).years }
    val oldEnough = age != null && age >= MINIMUM_AGE

    Spacer(Modifier.height(12.dp))
    LeafMark(Modifier.size(150.dp), glow = true)
    Text("Esmeralda", style = MaterialTheme.typography.displayMedium)
    Text("Gánate tu momento.", style = MaterialTheme.typography.titleMedium, color = Emerald)

    MatteCard {
        SectionLabel("Solo para mayores de edad")
        Spacer(Modifier.height(8.dp))
        Text(
            "Esmeralda convierte tus hábitos en un juego: cumple tus metas semanales de lectura, " +
                "fuerza e hidratación para habilitar tu consumo recreativo de cannabis, " +
                "siempre de forma consciente y responsable.",
            color = TextMuted,
        )
    }

    OutlinedButton(
        onClick = { showPicker = true },
        modifier = Modifier
            .fillMaxWidth()
            .height(56.dp),
        shape = RoundedCornerShape(18.dp),
        border = BorderStroke(1.dp, if (birthDate != null) Emerald else Hairline),
    ) {
        Text(
            birthDate?.let { "Nacimiento: ${it.format(birthFormat)}" } ?: "Indica tu fecha de nacimiento",
            color = TextPrimary,
        )
    }
    if (age != null && !oldEnough) {
        Text(
            "Debes tener al menos $MINIMUM_AGE años para usar Esmeralda.",
            color = Danger,
            textAlign = TextAlign.Center,
        )
    }

    ConsentRow(
        checked = consent.legal,
        onChange = { onChange(consent.copy(legal = it)) },
        text = "Soy mayor de edad y el uso recreativo de cannabis es legal donde vivo.",
    )
    ConsentRow(
        checked = consent.responsible,
        onChange = { onChange(consent.copy(responsible = it)) },
        text = "Entiendo que esta app no da consejo médico ni incentiva el consumo: su objetivo es un uso responsable.",
    )

    Button(
        onClick = onContinue,
        enabled = oldEnough && consent.legal && consent.responsible,
        modifier = Modifier
            .fillMaxWidth()
            .height(56.dp),
        shape = RoundedCornerShape(18.dp),
        colors = ButtonDefaults.buttonColors(containerColor = Emerald, contentColor = OnEmerald),
    ) {
        Text("Continuar", style = MaterialTheme.typography.titleMedium)
    }

    if (showPicker) {
        val todayMillis = today.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
        val pickerState = rememberDatePickerState(
            initialSelectedDateMillis = birthMillis,
            initialDisplayedMonthMillis = birthMillis
                ?: today.minusYears(25).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli(),
            yearRange = (today.year - 100)..today.year,
            selectableDates = object : SelectableDates {
                override fun isSelectableDate(utcTimeMillis: Long) = utcTimeMillis <= todayMillis
                override fun isSelectableYear(year: Int) = year <= today.year
            },
        )
        val pickerColors = DatePickerDefaults.colors(
            containerColor = GraphiteHigh,
            selectedDayContainerColor = Emerald,
            selectedDayContentColor = OnEmerald,
            selectedYearContainerColor = Emerald,
            selectedYearContentColor = OnEmerald,
            todayDateBorderColor = Emerald,
            todayContentColor = EmeraldBright,
        )
        DatePickerDialog(
            onDismissRequest = { showPicker = false },
            confirmButton = {
                TextButton(onClick = {
                    onChange(consent.copy(birthMillis = pickerState.selectedDateMillis))
                    showPicker = false
                }) { Text("Aceptar", color = Emerald) }
            },
            dismissButton = {
                TextButton(onClick = { showPicker = false }) { Text("Cancelar", color = TextMuted) }
            },
            colors = pickerColors,
        ) {
            DatePicker(state = pickerState, colors = pickerColors)
        }
    }
}

@Composable
private fun GoalsStep(goals: GoalSettings, onChange: (GoalSettings) -> Unit, onBack: () -> Unit, onStart: () -> Unit) {
    Spacer(Modifier.height(8.dp))
    LeafMark(Modifier.size(72.dp), glow = true)
    Text("Tus metas semanales", style = MaterialTheme.typography.headlineMedium, textAlign = TextAlign.Center)
    Text(
        "Cúmplelas todas para desbloquear la semana. Se reinician cada lunes y, " +
            "una vez empezada la semana, los cambios solo se aplican a la siguiente.",
        color = TextMuted,
        textAlign = TextAlign.Center,
    )
    MatteCard {
        GoalEditor(goals, onChange)
    }
    Button(
        onClick = onStart,
        modifier = Modifier
            .fillMaxWidth()
            .height(56.dp),
        shape = RoundedCornerShape(18.dp),
        colors = ButtonDefaults.buttonColors(containerColor = Emerald, contentColor = OnEmerald),
    ) {
        Text("Empezar mi semana", style = MaterialTheme.typography.titleMedium)
    }
    TextButton(onClick = onBack) { Text("Atrás", color = TextMuted) }
}

@Composable
private fun ConsentRow(checked: Boolean, onChange: (Boolean) -> Unit, text: String) {
    MatteCard(
        modifier = Modifier
            .clip(RoundedCornerShape(28.dp))
            .toggleable(value = checked, role = Role.Checkbox, onValueChange = onChange),
        highlighted = checked,
        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(
                checked = checked,
                onCheckedChange = null,
                colors = CheckboxDefaults.colors(
                    checkedColor = Emerald,
                    checkmarkColor = OnEmerald,
                    uncheckedColor = TextMuted,
                ),
            )
            Spacer(Modifier.size(12.dp))
            Text(text, color = if (checked) TextPrimary else TextMuted, style = MaterialTheme.typography.bodyMedium)
        }
    }
}


package com.pablovillamed.esmeralda.ui

import com.pablovillamed.esmeralda.R
import com.pablovillamed.esmeralda.domain.Habit
import com.pablovillamed.esmeralda.domain.WeekReport
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

private val spanish: Locale = Locale.forLanguageTag("es")
private val longDate = DateTimeFormatter.ofPattern("EEEE d 'de' MMMM", spanish)
private val dayMonth = DateTimeFormatter.ofPattern("d MMM", spanish)
private val weekday = DateTimeFormatter.ofPattern("EEEE d", spanish)

val dayInitials = listOf("L", "M", "X", "J", "V", "S", "D")

fun LocalDate.longLabel() = format(longDate).replaceFirstChar { it.titlecase(spanish) }

fun LocalDate.weekdayLabel() = format(weekday)

fun LocalDate.shortLabel(): String = format(dayMonth).trimEnd('.')

fun weekRange(start: LocalDate) = "${start.shortLabel()} – ${start.plusDays(6).shortLabel()}"

fun plural(n: Int, singular: String, plural: String) = "$n ${if (n == 1) singular else plural}"

val Habit.label
    get() = when (this) {
        Habit.READING -> "Lectura"
        Habit.WATER -> "Hidratación"
        Habit.WORKOUT -> "Fuerza"
    }

val Habit.icon
    get() = when (this) {
        Habit.READING -> R.drawable.ic_book
        Habit.WATER -> R.drawable.ic_drop
        Habit.WORKOUT -> R.drawable.ic_dumbbell
    }

/** Lo que falta para desbloquear la semana, p. ej. "1 día de lectura · 2 entrenamientos". */
fun WeekReport.missingText(): String = buildList {
    if (!reading.done) add(plural(reading.remaining, "día de lectura", "días de lectura"))
    if (!water.done) add(plural(water.remaining, "día de hidratación", "días de hidratación"))
    if (!workouts.done) add(plural(workouts.remaining, "entrenamiento", "entrenamientos"))
}.joinToString(" · ")

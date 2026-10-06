package com.pablovillamed.esmeralda.data

import kotlinx.serialization.Serializable

/**
 * Metas semanales que hay que cumplir para habilitar el consumo.
 *
 * Lectura y agua son metas diarias que deben alcanzarse un número mínimo de días;
 * los entrenamientos de fuerza se cuentan en total durante la semana.
 */
@Serializable
data class GoalSettings(
    val pagesPerDay: Int = 10,
    val readingDays: Int = 2,
    val workoutsPerWeek: Int = 2,
    val glassesPerDay: Int = 7,
    val waterDays: Int = 2,
    val maxSessionsPerWeek: Int = 3,
) {
    fun sanitized() = GoalSettings(
        pagesPerDay = pagesPerDay.coerceIn(1, 200),
        readingDays = readingDays.coerceIn(1, 7),
        workoutsPerWeek = workoutsPerWeek.coerceIn(1, 7),
        glassesPerDay = glassesPerDay.coerceIn(1, 20),
        waterDays = waterDays.coerceIn(1, 7),
        maxSessionsPerWeek = maxSessionsPerWeek.coerceIn(1, 7),
    )
}

/** Lo registrado en un día concreto. */
@Serializable
data class DayLog(
    val pages: Int = 0,
    val glasses: Int = 0,
    val workouts: Int = 0,
) {
    val isEmpty get() = pages == 0 && glasses == 0 && workouts == 0
}

/**
 * Todo el estado persistido de la app.
 *
 * Las fechas se guardan como texto ISO-8601 (`2026-10-06`) para que el JSON sea legible y estable.
 */
@Serializable
data class AppState(
    val ageVerified: Boolean = false,
    /** Metas vigentes indexadas por el lunes desde el que aplican. */
    val goalHistory: Map<String, GoalSettings> = emptyMap(),
    /** Registros diarios indexados por fecha. */
    val logs: Map<String, DayLog> = emptyMap(),
    /** Fecha y hora (ISO local) de cada sesión registrada. */
    val sessions: List<String> = emptyList(),
)

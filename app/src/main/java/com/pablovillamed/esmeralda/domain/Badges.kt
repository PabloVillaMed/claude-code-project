package com.pablovillamed.esmeralda.domain

enum class Badge(val title: String, val description: String, val target: Int) {
    FIRST_STEP("Primer paso", "Registra tu primera actividad", 1),
    BOOKWORM("Ratón de biblioteca", "Lee 100 páginas en total", 100),
    AVID_READER("Lector voraz", "Lee 1.000 páginas en total", 1000),
    HYDRATED("Bien hidratado", "Bebe 100 vasos de agua", 100),
    IRON_WILL("Voluntad de hierro", "Completa 10 entrenamientos de fuerza", 10),
    TITAN("Titán", "Completa 50 entrenamientos de fuerza", 50),
    EMERALD_WEEK("Semana esmeralda", "Cumple todas las metas de una semana", 1),
    DISCIPLINE("Disciplina", "Desbloquea la semana en sus dos primeros días", 1),
    CONSISTENCY("Constancia", "Encadena 3 semanas cumplidas", 3),
    UNSTOPPABLE("Imparable", "Encadena 8 semanas cumplidas", 8),
    MINDFUL_PAUSE("Pausa consciente", "Cumple una semana entera sin registrar sesiones", 1),
    FULL_BLOOM("Floración", "Alcanza el nivel 6", 6),
}

data class BadgeProgress(val badge: Badge, val current: Int, val target: Int) {
    val earned get() = current >= target
    val fraction get() = (current.toFloat() / target).coerceIn(0f, 1f)
}

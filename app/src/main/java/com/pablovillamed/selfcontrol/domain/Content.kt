package com.pablovillamed.selfcontrol.domain

import java.time.LocalDate

object Affirmations {
    private val all = listOf(
        "Hoy elijo cuidar mi cuerpo y mi mente.",
        "La disciplina de hoy es la libertad de mañana.",
        "Cada página que leo me hace crecer.",
        "Mi cuerpo es fuerte y lo trato con respeto.",
        "Disfruto más cuando primero me lo gano.",
        "Soy constante, no perfecto, y eso basta.",
        "El agua me da claridad y energía.",
        "Tengo el control de mis hábitos.",
        "Pequeños pasos, grandes cambios.",
        "Mi bienestar es mi prioridad.",
        "Hoy soy un poco mejor que ayer.",
        "Merezco el descanso que me gano con esfuerzo.",
        "Mi mente está tranquila y enfocada.",
        "Elijo con conciencia, disfruto con calma.",
        "La fuerza nace de la repetición.",
        "Respeto mis límites y celebro mis logros.",
        "Crezco como una planta: paso a paso, hacia la luz.",
        "Lo que hago a diario define quién soy.",
        "Me comprometo conmigo, y cumplo.",
        "El equilibrio es mi superpoder.",
    )

    fun forDate(date: LocalDate) = all[Math.floorMod(date.toEpochDay(), all.size.toLong()).toInt()]
}

object ResponsibleUse {
    val tips = listOf(
        "Nunca conduzcas ni operes maquinaria bajo sus efectos.",
        "Empieza con poco y ve despacio: los efectos pueden tardar.",
        "Evita mezclar con alcohol u otras sustancias.",
        "Mantente hidratado y ten algo de comer a mano.",
        "Consume solo en un lugar seguro, tranquilo y donde sea legal.",
        "No consumas si estás embarazada, en lactancia o tomas medicación sin consultar a un profesional.",
        "Si sientes que pierdes el control, haz una pausa y busca ayuda profesional.",
    )

    fun forDate(date: LocalDate) = tips[Math.floorMod(date.toEpochDay(), tips.size.toLong()).toInt()]
}

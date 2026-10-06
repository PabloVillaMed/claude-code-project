package com.pablovillamed.esmeralda.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

// Negro mate: tonos casi negros y sin brillo, apenas separados para dar profundidad.
val MatteBlack = Color(0xFF0B0C0B)
val Graphite = Color(0xFF131514)
val GraphiteHigh = Color(0xFF1A1D1B)
val GraphiteHighest = Color(0xFF222624)
val Hairline = Color(0xFF2A2F2C)

// Verde esmeralda: el único color de acento de la app.
val Emerald = Color(0xFF50C878)
val EmeraldBright = Color(0xFF7DF0A9)
val EmeraldDeep = Color(0xFF1F7A4D)
val EmeraldInk = Color(0xFF0E3B26)
val OnEmerald = Color(0xFF03140B)

val TextPrimary = Color(0xFFE6ECE8)
val TextMuted = Color(0xFF8E9892)
val TextFaint = Color(0xFF5A635E)
val Danger = Color(0xFFE5484D)

private val EsmeraldaColors = darkColorScheme(
    primary = Emerald,
    onPrimary = OnEmerald,
    primaryContainer = EmeraldInk,
    onPrimaryContainer = EmeraldBright,
    secondary = EmeraldBright,
    onSecondary = OnEmerald,
    secondaryContainer = EmeraldInk,
    onSecondaryContainer = EmeraldBright,
    tertiary = EmeraldBright,
    background = MatteBlack,
    onBackground = TextPrimary,
    surface = MatteBlack,
    onSurface = TextPrimary,
    surfaceVariant = GraphiteHigh,
    onSurfaceVariant = TextMuted,
    surfaceContainerLowest = MatteBlack,
    surfaceContainerLow = Graphite,
    surfaceContainer = Graphite,
    surfaceContainerHigh = GraphiteHigh,
    surfaceContainerHighest = GraphiteHighest,
    outline = Hairline,
    outlineVariant = Hairline,
    error = Danger,
    onError = Color.White,
)

private val base = Typography()

private val EsmeraldaType = Typography(
    displayLarge = base.displayLarge.copy(fontWeight = FontWeight.Black, letterSpacing = (-1).sp),
    displayMedium = base.displayMedium.copy(fontWeight = FontWeight.Black, letterSpacing = (-0.5).sp),
    displaySmall = base.displaySmall.copy(fontWeight = FontWeight.Bold),
    headlineLarge = base.headlineLarge.copy(fontWeight = FontWeight.Bold),
    headlineMedium = base.headlineMedium.copy(fontWeight = FontWeight.Bold),
    headlineSmall = base.headlineSmall.copy(fontWeight = FontWeight.Bold),
    titleLarge = base.titleLarge.copy(fontWeight = FontWeight.Bold),
    titleMedium = base.titleMedium.copy(fontWeight = FontWeight.SemiBold),
    titleSmall = base.titleSmall.copy(fontWeight = FontWeight.SemiBold),
    labelSmall = base.labelSmall.copy(fontWeight = FontWeight.Bold, letterSpacing = 1.6.sp),
)

/** Etiqueta en versalitas para encabezar secciones. */
val OverlineStyle = TextStyle(fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 2.sp)

@Composable
fun EsmeraldaTheme(content: @Composable () -> Unit) {
    // La app es siempre oscura: el negro mate es parte de su identidad.
    MaterialTheme(colorScheme = EsmeraldaColors, typography = EsmeraldaType, content = content)
}

package com.pablovillamed.esmeralda.ui.components

import androidx.annotation.DrawableRes
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.pablovillamed.esmeralda.ui.theme.Emerald
import com.pablovillamed.esmeralda.ui.theme.EmeraldBright
import com.pablovillamed.esmeralda.ui.theme.EmeraldDeep
import com.pablovillamed.esmeralda.ui.theme.EmeraldInk
import com.pablovillamed.esmeralda.ui.theme.GraphiteHigh
import com.pablovillamed.esmeralda.ui.theme.GraphiteHighest
import com.pablovillamed.esmeralda.ui.theme.Hairline
import com.pablovillamed.esmeralda.ui.theme.OverlineStyle
import com.pablovillamed.esmeralda.ui.theme.TextMuted
import com.pablovillamed.esmeralda.ui.theme.TextPrimary
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin
import kotlin.random.Random

/** Folíolos de la hoja: ángulo respecto a la vertical, largo y ancho relativos al lienzo. */
private val leaflets = listOf(
    Triple(100f, 0.15f, 0.038f), Triple(-100f, 0.15f, 0.038f),
    Triple(64f, 0.26f, 0.056f), Triple(-64f, 0.26f, 0.056f),
    Triple(32f, 0.35f, 0.068f), Triple(-32f, 0.35f, 0.068f),
    Triple(0f, 0.42f, 0.08f),
)

/** La hoja de la marca, con la misma geometría que el ícono del lanzador. */
@Composable
fun LeafMark(modifier: Modifier = Modifier, color: Color = Emerald, glow: Boolean = false) {
    Canvas(modifier) {
        val s = size.minDimension
        val base = Offset(size.width / 2, size.height / 2 + s * 0.12f)
        if (glow) {
            drawCircle(
                Brush.radialGradient(listOf(color.copy(alpha = 0.35f), Color.Transparent), center, s / 2),
                radius = s / 2,
            )
        }
        drawLine(
            EmeraldDeep, base, base + Offset(0f, s * 0.22f),
            strokeWidth = s * 0.03f, cap = StrokeCap.Round,
        )
        for ((angle, length, width) in leaflets) {
            val l = length * s
            val w = width * s
            rotate(angle, pivot = base) {
                val path = Path().apply {
                    moveTo(base.x, base.y)
                    cubicTo(base.x + w, base.y - 0.3f * l, base.x + 0.7f * w, base.y - 0.75f * l, base.x, base.y - l)
                    cubicTo(base.x - 0.7f * w, base.y - 0.75f * l, base.x - w, base.y - 0.3f * l, base.x, base.y)
                    close()
                }
                drawPath(path, color)
                drawLine(
                    EmeraldDeep, base - Offset(0f, l * 0.06f), base - Offset(0f, l * 0.85f),
                    strokeWidth = s * 0.008f, cap = StrokeCap.Round,
                )
            }
        }
    }
}

/** Anillo de progreso esmeralda con halo luminoso. */
@Composable
fun ProgressRing(
    progress: Float,
    modifier: Modifier = Modifier,
    strokeWidth: Dp = 14.dp,
    content: @Composable BoxScope.() -> Unit,
) {
    val animated by animateFloatAsState(
        targetValue = progress.coerceIn(0f, 1f),
        animationSpec = tween(900, easing = FastOutSlowInEasing),
        label = "ring",
    )
    Box(modifier, contentAlignment = Alignment.Center) {
        Canvas(Modifier.matchParentSize()) {
            val stroke = strokeWidth.toPx()
            val inset = stroke * 1.8f
            val arcSize = Size(size.width - inset * 2, size.height - inset * 2)
            val topLeft = Offset(inset, inset)
            drawArc(Hairline, 0f, 360f, false, topLeft, arcSize, style = Stroke(stroke))
            if (animated <= 0f) return@Canvas

            val sweep = 360f * animated
            rotate(-90f) {
                for (layer in 3 downTo 1) {
                    drawArc(
                        Emerald.copy(alpha = 0.05f * (4 - layer)), 0f, sweep, false, topLeft, arcSize,
                        style = Stroke(stroke + layer * stroke * 0.7f, cap = StrokeCap.Round),
                    )
                }
                val head = animated.coerceIn(0.01f, 0.999f)
                drawArc(
                    Brush.sweepGradient(0f to EmeraldDeep, head to EmeraldBright, 1f to EmeraldDeep),
                    0f, sweep, false, topLeft, arcSize,
                    style = Stroke(stroke, cap = StrokeCap.Round),
                )
                val radius = arcSize.width / 2
                val angle = sweep * PI.toFloat() / 180f
                val knob = center + Offset(cos(angle) * radius, sin(angle) * radius)
                drawCircle(EmeraldBright.copy(alpha = 0.25f), stroke * 1.1f, knob)
                drawCircle(EmeraldBright, stroke * 0.42f, knob)
            }
        }
        content()
    }
}

/** Tarjeta mate con borde fino; [highlighted] la enciende en esmeralda. */
@Composable
fun MatteCard(
    modifier: Modifier = Modifier,
    highlighted: Boolean = false,
    contentPadding: PaddingValues = PaddingValues(20.dp),
    content: @Composable ColumnScope.() -> Unit,
) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(28.dp),
        color = if (highlighted) EmeraldInk.copy(alpha = 0.55f) else GraphiteHigh,
        // Explícito: GraphiteHigh coincide con surfaceVariant y heredaría el texto atenuado.
        contentColor = TextPrimary,
        border = BorderStroke(1.dp, if (highlighted) Emerald.copy(alpha = 0.6f) else Hairline),
    ) {
        Column(Modifier.padding(contentPadding), content = content)
    }
}

@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier, color: Color = Emerald) {
    Text(text.uppercase(), modifier = modifier, style = OverlineStyle, color = color)
}

/** Icono dentro de un círculo esmeralda tenue. */
@Composable
fun IconBadge(@DrawableRes icon: Int, modifier: Modifier = Modifier, size: Dp = 44.dp, active: Boolean = true) {
    Box(
        modifier
            .size(size)
            .clip(CircleShape)
            .background(if (active) EmeraldInk else GraphiteHighest),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            painterResource(icon), contentDescription = null,
            tint = if (active) Emerald else TextMuted,
            modifier = Modifier.size(size * 0.5f),
        )
    }
}

@Composable
fun RoundIconButton(
    @DrawableRes icon: Int,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    filled: Boolean = false,
) {
    Surface(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.size(44.dp),
        shape = CircleShape,
        color = if (filled) Emerald else GraphiteHighest,
        border = if (filled) null else BorderStroke(1.dp, Hairline),
    ) {
        Box(contentAlignment = Alignment.Center) {
            Icon(
                painterResource(icon), contentDescription,
                tint = when {
                    !enabled -> TextMuted.copy(alpha = 0.4f)
                    filled -> Color.Black
                    else -> TextPrimary
                },
                modifier = Modifier.size(20.dp),
            )
        }
    }
}

/** Botón compacto de incremento rápido (+5, +10...). */
@Composable
fun QuickChip(label: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    Surface(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.height(44.dp),
        shape = RoundedCornerShape(22.dp),
        color = EmeraldInk,
        border = BorderStroke(1.dp, Emerald.copy(alpha = 0.35f)),
    ) {
        Box(Modifier.padding(horizontal = 16.dp), contentAlignment = Alignment.Center) {
            Text(label, color = if (enabled) EmeraldBright else TextMuted, fontWeight = FontWeight.Bold)
        }
    }
}

/** Una píldora por unidad requerida; las cumplidas se encienden. */
@Composable
fun PillProgress(current: Int, required: Int, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        repeat(required) { index ->
            val on = index < current
            Box(
                Modifier
                    .weight(1f)
                    .height(8.dp)
                    .clip(RoundedCornerShape(4.dp))
                    .background(
                        if (on) Brush.horizontalGradient(listOf(EmeraldDeep, EmeraldBright))
                        else Brush.horizontalGradient(listOf(GraphiteHighest, GraphiteHighest)),
                    ),
            )
        }
    }
}

/** Barra de progreso continua. */
@Composable
fun GlowBar(fraction: Float, modifier: Modifier = Modifier, height: Dp = 10.dp) {
    val animated by animateFloatAsState(fraction.coerceIn(0f, 1f), tween(700), label = "bar")
    Box(
        modifier
            .fillMaxWidth()
            .height(height)
            .clip(RoundedCornerShape(height / 2))
            .background(GraphiteHighest),
    ) {
        if (animated > 0f) {
            Box(
                Modifier
                    .fillMaxWidth(animated)
                    .height(height)
                    .clip(RoundedCornerShape(height / 2))
                    .background(Brush.horizontalGradient(listOf(EmeraldDeep, Emerald, EmeraldBright))),
            )
        }
    }
}

@Composable
fun StatChip(@DrawableRes icon: Int, text: String, modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(50),
        color = GraphiteHigh,
        border = BorderStroke(1.dp, Hairline),
    ) {
        Row(
            Modifier.padding(horizontal = 12.dp, vertical = 7.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Icon(painterResource(icon), null, tint = Emerald, modifier = Modifier.size(16.dp))
            Text(text, color = TextPrimary, fontWeight = FontWeight.Bold)
        }
    }
}

private class Particle(
    val x: Float,
    val delay: Float,
    val speed: Float,
    val drift: Float,
    val spin: Float,
    val size: Float,
    val color: Color,
    val round: Boolean,
)

/** Lluvia de confeti esmeralda. Se reproduce cada vez que cambia [trigger] (si es > 0). */
@Composable
fun Celebration(trigger: Int, modifier: Modifier = Modifier) {
    val progress = remember { Animatable(1f) }
    val particles = remember(trigger) {
        val random = Random(trigger)
        val palette = listOf(Emerald, EmeraldBright, EmeraldDeep, TextPrimary)
        List(90) {
            Particle(
                x = random.nextFloat(),
                delay = random.nextFloat() * 0.35f,
                speed = 0.8f + random.nextFloat() * 0.7f,
                drift = (random.nextFloat() - 0.5f) * 0.25f,
                spin = (random.nextFloat() - 0.5f) * 1440f,
                size = 6f + random.nextFloat() * 10f,
                color = palette[random.nextInt(palette.size)],
                round = random.nextBoolean(),
            )
        }
    }
    LaunchedEffect(trigger) {
        if (trigger > 0) {
            progress.snapTo(0f)
            progress.animateTo(1f, tween(2800, easing = LinearEasing))
        }
    }
    if (progress.value >= 1f) return
    Canvas(modifier.fillMaxSize()) {
        val t = progress.value
        for (p in particles) {
            val local = ((t - p.delay) / (1f - p.delay)).coerceIn(0f, 1f)
            if (local <= 0f) continue
            val position = Offset(
                x = (p.x + p.drift * local + sin(local * 9f + p.x * 6f) * 0.02f) * size.width,
                y = (-0.05f + local * p.speed * 1.1f) * size.height,
            )
            val alpha = if (local > 0.8f) (1f - local) / 0.2f else 1f
            drawConfetti(p, position, local, alpha)
        }
    }
}

private fun DrawScope.drawConfetti(p: Particle, position: Offset, local: Float, alpha: Float) {
    val px = p.size * density / 2.5f
    if (p.round) {
        drawCircle(p.color.copy(alpha = alpha), px / 2, position)
        return
    }
    withTransform({ rotate(p.spin * local, position) }) {
        drawRoundRect(
            p.color.copy(alpha = alpha),
            topLeft = position - Offset(px / 2, px / 4),
            size = Size(px, px / 2),
            cornerRadius = CornerRadius(px / 6),
        )
    }
}

/** Contenedor de pantalla con fondo negro mate. */
@Composable
fun ScreenBackground(content: @Composable BoxScope.() -> Unit) {
    Box(
        Modifier
            .fillMaxSize()
            .background(
                Brush.radialGradient(
                    listOf(EmeraldInk.copy(alpha = 0.35f), Color.Transparent),
                    center = Offset(0f, 0f),
                    radius = 1400f,
                ),
            ),
        content = content,
    )
}

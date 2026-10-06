package com.pablovillamed.selfcontrol.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.pablovillamed.selfcontrol.data.GoalSettings
import com.pablovillamed.selfcontrol.domain.ResponsibleUse
import com.pablovillamed.selfcontrol.ui.UiState
import com.pablovillamed.selfcontrol.ui.components.GoalEditor
import com.pablovillamed.selfcontrol.ui.components.GoalSettingsSaver
import com.pablovillamed.selfcontrol.ui.components.MatteCard
import com.pablovillamed.selfcontrol.ui.components.SectionLabel
import com.pablovillamed.selfcontrol.ui.shortLabel
import com.pablovillamed.selfcontrol.ui.theme.Danger
import com.pablovillamed.selfcontrol.ui.theme.Emerald
import com.pablovillamed.selfcontrol.ui.theme.EmeraldBright
import com.pablovillamed.selfcontrol.ui.theme.GraphiteHigh
import com.pablovillamed.selfcontrol.ui.theme.OnEmerald
import com.pablovillamed.selfcontrol.ui.theme.TextMuted
import com.pablovillamed.selfcontrol.ui.theme.TextPrimary

@Composable
fun SettingsScreen(ui: UiState, onScheduleGoals: (GoalSettings) -> Unit, onReset: () -> Unit) {
    val nextMonday = ui.week.weekStart.plusWeeks(1).shortLabel()
    val nextGoals = ui.pendingGoals ?: ui.week.goals
    var draft by rememberSaveable(nextGoals, stateSaver = GoalSettingsSaver) { mutableStateOf(nextGoals) }
    var confirmReset by rememberSaveable { mutableStateOf(false) }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Column {
            SectionLabel("Configuración")
            Text("Ajustes", style = MaterialTheme.typography.headlineMedium)
        }

        MatteCard {
            SectionLabel("Metas semanales")
            Spacer(Modifier.height(6.dp))
            Text(
                "Para que nadie baje el listón a mitad de semana, los cambios se aplican desde el lunes $nextMonday.",
                color = TextMuted,
                style = MaterialTheme.typography.bodySmall,
            )
            Spacer(Modifier.height(16.dp))
            GoalEditor(draft, onChange = { draft = it.sanitized() })
            Spacer(Modifier.height(16.dp))
            Button(
                onClick = { onScheduleGoals(draft) },
                enabled = draft != nextGoals,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp),
                shape = RoundedCornerShape(18.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Emerald, contentColor = OnEmerald),
            ) {
                Text("Programar para el lunes $nextMonday", fontWeight = FontWeight.Bold)
            }
            if (ui.pendingGoals != null) {
                Spacer(Modifier.height(8.dp))
                Text(
                    "Hay cambios programados para el lunes $nextMonday.",
                    color = EmeraldBright,
                    style = MaterialTheme.typography.bodySmall,
                )
                TextButton(onClick = { onScheduleGoals(ui.week.goals) }) {
                    Text("Mantener las metas actuales", color = TextMuted)
                }
            }
        }

        MatteCard {
            SectionLabel("Uso responsable")
            Spacer(Modifier.height(8.dp))
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                ResponsibleUse.tips.forEach { Text("•  $it", color = TextPrimary) }
            }
        }

        MatteCard {
            SectionLabel("Acerca de Self Control")
            Spacer(Modifier.height(8.dp))
            Text(
                "Self Control es una herramienta de hábitos para personas adultas que consumen cannabis de forma " +
                    "recreativa y legal. No promueve el consumo, no vende ni facilita sustancias y no " +
                    "sustituye el consejo médico. Si el consumo te preocupa, habla con un profesional de la salud.",
                color = TextMuted,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                "Tus datos se guardan solo en este dispositivo.",
                color = TextMuted,
                style = MaterialTheme.typography.bodySmall,
            )
        }

        OutlinedButton(
            onClick = { confirmReset = true },
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp),
            shape = RoundedCornerShape(18.dp),
            border = BorderStroke(1.dp, Danger.copy(alpha = 0.6f)),
        ) {
            Text("Borrar todos los datos", color = Danger)
        }
        Spacer(Modifier.height(8.dp))
    }

    if (confirmReset) {
        AlertDialog(
            onDismissRequest = { confirmReset = false },
            containerColor = GraphiteHigh,
            title = { Text("¿Borrar todo?") },
            text = {
                Text(
                    "Se eliminarán tus registros, niveles e insignias, y volverás a la verificación de edad. " +
                        "No se puede deshacer.",
                    color = TextMuted,
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    confirmReset = false
                    onReset()
                }) { Text("Borrar", color = Danger, fontWeight = FontWeight.Bold) }
            },
            dismissButton = {
                TextButton(onClick = { confirmReset = false }) { Text("Cancelar", color = TextMuted) }
            },
        )
    }
}

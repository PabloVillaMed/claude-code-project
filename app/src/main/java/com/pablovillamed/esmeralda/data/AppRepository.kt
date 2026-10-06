package com.pablovillamed.esmeralda.data

import android.content.Context
import androidx.datastore.core.CorruptionException
import androidx.datastore.core.DataStore
import androidx.datastore.core.Serializer
import androidx.datastore.core.handlers.ReplaceFileCorruptionHandler
import androidx.datastore.dataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import java.io.InputStream
import java.io.OutputStream

private val json = Json {
    ignoreUnknownKeys = true
    encodeDefaults = true
}

private object AppStateSerializer : Serializer<AppState> {
    override val defaultValue = AppState()

    override suspend fun readFrom(input: InputStream): AppState = try {
        json.decodeFromString(AppState.serializer(), input.readBytes().decodeToString())
    } catch (e: SerializationException) {
        throw CorruptionException("No se pudo leer el estado guardado", e)
    }

    override suspend fun writeTo(t: AppState, output: OutputStream) {
        output.write(json.encodeToString(AppState.serializer(), t).encodeToByteArray())
    }
}

private val Context.appStateStore: DataStore<AppState> by dataStore(
    fileName = "esmeralda_state.json",
    serializer = AppStateSerializer,
    // Un archivo ilegible no debe dejar la app inservible: se empieza de cero.
    corruptionHandler = ReplaceFileCorruptionHandler { AppState() },
)

class AppRepository(context: Context) {
    private val store = context.applicationContext.appStateStore

    val state: Flow<AppState> = store.data

    suspend fun update(transform: (AppState) -> AppState) {
        store.updateData(transform)
    }
}

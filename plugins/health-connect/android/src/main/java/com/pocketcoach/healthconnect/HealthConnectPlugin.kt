package com.pocketcoach.healthconnect

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import androidx.activity.result.ActivityResult
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.NutritionRecord
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.time.TimeRangeFilter
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.time.Instant

/**
 * Reads daily nutrition totals from Health Connect. Food apps such as
 * Cronometer write NutritionRecords there; we only read the summed totals
 * for a time range (the web side passes local midnight to midnight).
 */
@CapacitorPlugin(name = "HealthConnect")
class HealthConnectPlugin : Plugin() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val readNutrition = HealthPermission.getReadPermission(NutritionRecord::class)
    private val permissions = setOf(readNutrition)

    private fun sdkStatus(): Int = HealthConnectClient.getSdkStatus(context)

    private fun client(): HealthConnectClient? =
        if (sdkStatus() == HealthConnectClient.SDK_AVAILABLE) HealthConnectClient.getOrCreate(context) else null

    /** status: "available" | "update_required" | "unavailable"; granted: read permission held. */
    @PluginMethod
    fun getStatus(call: PluginCall) {
        val status = when (sdkStatus()) {
            HealthConnectClient.SDK_AVAILABLE -> "available"
            HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> "update_required"
            else -> "unavailable"
        }
        val hc = client()
        if (hc == null) {
            call.resolve(statusResult(status, false))
            return
        }
        scope.launch {
            try {
                val granted = hc.permissionController.getGrantedPermissions().containsAll(permissions)
                call.resolve(statusResult(status, granted))
            } catch (e: Exception) {
                call.reject("Could not check Health Connect permissions", e)
            }
        }
    }

    private fun statusResult(status: String, granted: Boolean): JSObject {
        val out = JSObject()
        out.put("status", status)
        out.put("granted", granted)
        return out
    }

    @PluginMethod
    fun requestPermission(call: PluginCall) {
        if (client() == null) {
            call.reject("Health Connect is not available")
            return
        }
        val contract = PermissionController.createRequestPermissionResultContract()
        val intent = contract.createIntent(context, permissions)
        startActivityForResult(call, intent, "permissionResult")
    }

    @ActivityCallback
    fun permissionResult(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        val contract = PermissionController.createRequestPermissionResultContract()
        val granted = contract.parseResult(result.resultCode, result.data).containsAll(permissions)
        val out = JSObject()
        out.put("granted", granted)
        call.resolve(out)
    }

    /**
     * Options: start, end (epoch milliseconds). Returns energyKcal, protein,
     * carbs, fat (grams), hasData, and sources (package names that wrote data).
     */
    @PluginMethod
    fun getNutritionTotals(call: PluginCall) {
        // optLong copes with however the bridge parsed the number (int, long, double).
        val start = call.data.optLong("start", -1L)
        val end = call.data.optLong("end", -1L)
        if (start < 0 || end <= start) {
            call.reject("start and end are required")
            return
        }
        val hc = client()
        if (hc == null) {
            call.reject("Health Connect is not available")
            return
        }
        scope.launch {
            try {
                val response = hc.aggregate(
                    AggregateRequest(
                        metrics = setOf(
                            NutritionRecord.ENERGY_TOTAL,
                            NutritionRecord.PROTEIN_TOTAL,
                            NutritionRecord.TOTAL_CARBOHYDRATE_TOTAL,
                            NutritionRecord.TOTAL_FAT_TOTAL,
                        ),
                        timeRangeFilter = TimeRangeFilter.between(
                            Instant.ofEpochMilli(start),
                            Instant.ofEpochMilli(end),
                        ),
                    )
                )
                val energy = response[NutritionRecord.ENERGY_TOTAL]
                val protein = response[NutritionRecord.PROTEIN_TOTAL]
                val carbs = response[NutritionRecord.TOTAL_CARBOHYDRATE_TOTAL]
                val fat = response[NutritionRecord.TOTAL_FAT_TOTAL]
                val sources = JSArray()
                response.dataOrigins.forEach { sources.put(it.packageName) }
                val out = JSObject()
                out.put("energyKcal", energy?.inKilocalories ?: 0.0)
                out.put("protein", protein?.inGrams ?: 0.0)
                out.put("carbs", carbs?.inGrams ?: 0.0)
                out.put("fat", fat?.inGrams ?: 0.0)
                out.put("hasData", listOf(energy, protein, carbs, fat).any { it != null })
                out.put("sources", sources)
                call.resolve(out)
            } catch (e: SecurityException) {
                call.reject("Nutrition permission not granted", "PERMISSION_DENIED", e)
            } catch (e: Exception) {
                call.reject("Could not read nutrition from Health Connect", e)
            }
        }
    }

    /** Opens Health Connect (its settings), or its Play Store page if it isn't installed. */
    @PluginMethod
    fun openHealthConnect(call: PluginCall) {
        val intent = if (sdkStatus() == HealthConnectClient.SDK_AVAILABLE) {
            Intent(HealthConnectClient.ACTION_HEALTH_CONNECT_SETTINGS)
        } else {
            Intent(Intent.ACTION_VIEW).apply {
                setPackage("com.android.vending")
                data = Uri.parse("market://details?id=$PROVIDER&url=healthconnect%3A%2F%2Fonboarding")
                putExtra("overlay", true)
                putExtra("callerId", context.packageName)
            }
        }
        try {
            activity.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            call.resolve()
        } catch (e: ActivityNotFoundException) {
            call.reject("Could not open Health Connect", e)
        }
    }

    override fun handleOnDestroy() {
        scope.cancel()
        super.handleOnDestroy()
    }

    companion object {
        private const val PROVIDER = "com.google.android.apps.healthdata"
    }
}

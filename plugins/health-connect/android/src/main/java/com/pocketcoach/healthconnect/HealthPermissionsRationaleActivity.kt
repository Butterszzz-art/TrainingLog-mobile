package com.pocketcoach.healthconnect

import android.app.Activity
import android.os.Bundle
import android.util.TypedValue
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Shown by Health Connect when the user asks why Pocket Coach wants their
 * data (required before Health Connect will show the permission dialog).
 */
class HealthPermissionsRationaleActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val pad = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 24f, resources.displayMetrics).toInt()
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad, pad, pad)
        }
        layout.addView(TextView(this).apply {
            text = "How Pocket Coach uses your nutrition data"
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
        })
        layout.addView(TextView(this).apply {
            text = "Pocket Coach reads the daily totals of calories, protein, carbs and fat " +
                "that food apps such as Cronometer save to Health Connect. It adds them to " +
                "today's macros so you don't have to log food twice. Pocket Coach only reads " +
                "this data, never writes it, and never shares or sells it or uses it for ads. " +
                "You can turn access off at any time in Health Connect. See the Privacy Policy " +
                "in the app (Settings) for details."
            setPadding(0, pad / 2, 0, pad / 2)
        })
        layout.addView(Button(this).apply {
            text = "OK"
            setOnClickListener { finish() }
        })
        setContentView(layout)
    }
}

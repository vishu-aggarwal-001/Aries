package app.aries

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.webkit.*
import android.widget.*
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout

/**
 * Aries for Android: a fast native shell around the Aries web app, so every
 * feature ships to web and phone at once. Adds the Android share sheet ("Send to Aries"),
 * file uploads, pull-to-refresh, and keeps sign-in between launches.
 */
class MainActivity : Activity() {
    private lateinit var web: WebView
    private lateinit var swipe: SwipeRefreshLayout
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private val prefs by lazy { getSharedPreferences("aries", MODE_PRIVATE) }

    /** Hosts that stay inside the app: our server plus sign-in and checkout flows that must return here. */
    private val inAppHosts = listOf("myshopify.com", "accounts.shopify.com", "admin.shopify.com", "checkout.stripe.com", "billing.stripe.com")

    private val base: String
        get() = BuildConfig.SERVER_URL.ifBlank { prefs.getString("server", "") ?: "" }.trimEnd('/')

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (base.isBlank()) showServerSetup() else showWeb(savedInstanceState)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun showWeb(state: Bundle?) {
        web = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#0D0F1E"))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            settings.userAgentString = settings.userAgentString + " AriesAndroid/1.0"
            webViewClient = Client()
            webChromeClient = Chrome()
        }
        CookieManager.getInstance().setAcceptCookie(true)
        swipe = SwipeRefreshLayout(this).apply {
            setColorSchemeColors(Color.parseColor("#F3B53F")); setProgressBackgroundColorSchemeColor(Color.parseColor("#1E2342"))
            addView(web); setOnRefreshListener { web.reload() }
            setOnChildScrollUpCallback { _, _ -> web.scrollY > 0 }
        }
        setContentView(swipe)
        if (state != null) web.restoreState(state) else web.loadUrl(startUrl(intent))
    }

    private fun startUrl(i: Intent?): String {
        if (i?.action == Intent.ACTION_SEND && i.type == "text/plain") {
            val text = listOfNotNull(i.getStringExtra(Intent.EXTRA_SUBJECT), i.getStringExtra(Intent.EXTRA_TEXT)).joinToString("\n")
            return "$base/share?text=" + Uri.encode(text)
        }
        return "$base/"
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (::web.isInitialized && intent.action == Intent.ACTION_SEND) web.loadUrl(startUrl(intent))
    }

    override fun onSaveInstanceState(out: Bundle) { super.onSaveInstanceState(out); if (::web.isInitialized) web.saveState(out) }

    @Deprecated("Back handling for API 26+")
    override fun onBackPressed() {
        if (::web.isInitialized && web.canGoBack()) web.goBack() else @Suppress("DEPRECATION") super.onBackPressed()
    }

    private fun isInApp(uri: Uri): Boolean {
        val host = uri.host ?: return false
        val ours = Uri.parse(base).host
        return host == ours || inAppHosts.any { host == it || host.endsWith(".$it") }
    }

    private inner class Client : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
            val uri = req.url
            if (uri.scheme == "aries" && uri.host == "server") { showServerSetup(); return true }
            if (uri.scheme in listOf("http", "https") && isInApp(uri)) return false
            runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
            return true
        }
        override fun onPageFinished(view: WebView, url: String) { swipe.isRefreshing = false; CookieManager.getInstance().flush() }
        override fun onReceivedError(view: WebView, req: WebResourceRequest, err: WebResourceError) {
            if (!req.isForMainFrame) return
            swipe.isRefreshing = false
            view.loadDataWithBaseURL(null, offlinePage(err.description?.toString() ?: "No connection"), "text/html", "utf-8", null)
        }
    }

    private inner class Chrome : WebChromeClient() {
        override fun onShowFileChooser(v: WebView, cb: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
            fileCallback?.onReceiveValue(null); fileCallback = cb
            return runCatching { startActivityForResult(params.createIntent(), 42); true }.getOrElse { fileCallback = null; false }
        }
    }

    @Deprecated("Activity result for file chooser")
    override fun onActivityResult(req: Int, res: Int, data: Intent?) {
        if (req == 42) { fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(res, data)); fileCallback = null }
        else @Suppress("DEPRECATION") super.onActivityResult(req, res, data)
    }

    private fun offlinePage(why: String) = """
        <html><body style="background:#0D0F1E;color:#ECE9F7;font-family:sans-serif;padding:32px;display:flex;flex-direction:column;justify-content:center;min-height:80vh">
        <div style="color:#F3B53F;letter-spacing:.2em;font-weight:800;font-size:12px">ARIES</div>
        <h1 style="font-family:serif">Can't reach your crew</h1><p style="color:#8D90B3">${why.replace("<", "&lt;")}</p>
        <p><a href="$base/" style="display:inline-block;background:#F3B53F;color:#241703;padding:12px 20px;border-radius:12px;text-decoration:none;font-weight:700">Try again</a></p>
        ${if (BuildConfig.SERVER_URL.isBlank()) "<p><a href=\"aries://server\" style=\"color:#8FB4FF\">Change server address</a></p>" else ""}
        </body></html>""".trimIndent()

    /** Only shown when the app wasn't built with a server URL (developer and self-hosted builds). */
    private fun showServerSetup() {
        val pad = (20 * resources.displayMetrics.density).toInt()
        val input = EditText(this).apply {
            hint = "https://app.yourdomain.com"; setText(prefs.getString("server", "")); inputType = InputType.TYPE_TEXT_VARIATION_URI
            setTextColor(Color.parseColor("#ECE9F7")); setHintTextColor(Color.parseColor("#8D90B3"))
        }
        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_VERTICAL; setPadding(pad, pad, pad, pad); setBackgroundColor(Color.parseColor("#0D0F1E"))
            addView(TextView(context).apply { text = "ARIES"; setTextColor(Color.parseColor("#F3B53F")); letterSpacing = 0.2f; textSize = 12f })
            addView(TextView(context).apply { text = "Where is your Aries server?"; setTextColor(Color.parseColor("#ECE9F7")); textSize = 26f; setPadding(0, pad / 2, 0, pad / 2) })
            addView(input, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
            addView(Button(context).apply {
                text = "Continue"
                setOnClickListener {
                    val v = input.text.toString().trim().let { if (it.startsWith("http")) it else "https://$it" }
                    prefs.edit().putString("server", v).apply(); recreate()
                }
            })
        }
        setContentView(col)
    }
}

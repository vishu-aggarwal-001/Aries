plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
// Build for your domain:  ./gradlew assembleRelease -PariesUrl=https://app.yourdomain.com
val ariesUrl = (project.findProperty("ariesUrl") as String?) ?: ""
android {
    namespace = "app.aries"
    compileSdk = 35
    defaultConfig {
        applicationId = "app.aries"
        minSdk = 26; targetSdk = 35; versionCode = 1; versionName = "1.0"
        buildConfigField("String", "SERVER_URL", "\"$ariesUrl\"")
    }
    buildFeatures { buildConfig = true }
    buildTypes {
        debug { manifestPlaceholders["cleartext"] = "true" }
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
            manifestPlaceholders["cleartext"] = "false"
            // Replace with your upload key before publishing to Play.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}
dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")
}

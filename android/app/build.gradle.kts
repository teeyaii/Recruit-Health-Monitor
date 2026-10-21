plugins {
 id("com.android.application")
 id("org.jetbrains.kotlin.android")
}
dependencies { testImplementation("junit:junit:4.13.2") }
android {
 compileOptions {
  sourceCompatibility = JavaVersion.VERSION_17
  targetCompatibility = JavaVersion.VERSION_17
 }
 kotlinOptions { jvmTarget = "17" }
 namespace = "org.recruit.monitor"
 compileSdk = 35
 defaultConfig {
  applicationId = "org.recruit.monitor"
  minSdk = 26
  targetSdk = 34
  versionCode = 1
  versionName = "0.1"
 }
}


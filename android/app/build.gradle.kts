plugins {
 id("com.android.application")
 id("org.jetbrains.kotlin.android")
}
android {
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

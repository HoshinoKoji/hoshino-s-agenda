plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("com.google.devtools.ksp")
}

android {
    namespace = "club.hoshino.agenda"
    compileSdk = 36
    buildToolsVersion = "36.0.0"
    defaultConfig {
        applicationId = "club.hoshino.agenda"
        minSdk = 26
        targetSdk = 36
        versionCode = 4
        versionName = "0.1.3"
        manifestPlaceholders["appAuthRedirectScheme"] = "club.hoshino.agenda"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures { compose = true; buildConfig = true }
    signingConfigs {
        getByName("debug") {
            storeFile = file(System.getenv("AGENDA_ANDROID_KEYSTORE") ?: "${System.getenv("ANDROID_USER_HOME") ?: "${System.getProperty("user.home")}/.android"}/debug.keystore")
            storePassword = System.getenv("AGENDA_ANDROID_STORE_PASSWORD") ?: "android"
            keyAlias = System.getenv("AGENDA_ANDROID_KEY_ALIAS") ?: "androiddebugkey"
            keyPassword = System.getenv("AGENDA_ANDROID_KEY_PASSWORD") ?: "android"
        }
        create("release") {
            System.getenv("AGENDA_ANDROID_KEYSTORE")?.let { storeFile = file(it) }
            storePassword = System.getenv("AGENDA_ANDROID_STORE_PASSWORD")
            keyAlias = System.getenv("AGENDA_ANDROID_KEY_ALIAS")
            keyPassword = System.getenv("AGENDA_ANDROID_KEY_PASSWORD")
        }
    }
    buildTypes {
        release { signingConfig = signingConfigs.getByName("release"); isMinifyEnabled = false }
    }
    testOptions {
        unitTests.isIncludeAndroidResources = true
        unitTests.all { it.systemProperty("robolectric.dependency.repo.url", "https://repo.maven.apache.org/maven2") }
    }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
}
kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }
ksp { arg("room.schemaLocation", "$projectDir/schemas") }
dependencyLocking {
    lockAllConfigurations()
    // Kotlin's common metadata redirects to the JVM module and can disappear from a cached
    // Android resolution. The actual kotlin-stdlib JVM dependency remains version-locked.
    ignoredDependencies.add("org.jetbrains.kotlin:kotlin-stdlib-common")
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2025.10.01"))
    implementation("androidx.activity:activity-compose:1.11.0")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.4")
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.datastore:datastore-preferences:1.1.7")
    implementation("androidx.room:room-runtime:2.8.3")
    implementation("androidx.room:room-ktx:2.8.3")
    ksp("androidx.room:room-compiler:2.8.3")
    implementation("androidx.work:work-runtime-ktx:2.10.3")
    implementation("androidx.glance:glance-appwidget:1.1.1")
    implementation("net.openid:appauth:0.11.1")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.9.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
    testImplementation("org.robolectric:robolectric:4.16")
    testImplementation("androidx.test:core:1.7.0")
}

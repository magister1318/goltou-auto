// Reference: ../refs/DAF/daf3/apps/mobile/android/app/src/main/cpp/native-lib.cpp
// Starts the embedded Node.js (nodejs-mobile) on the calling thread and pipes its
// stdout/stderr to logcat only in debug (release discards it). node::Start runs once per process.
#include <jni.h>
#include <android/log.h>
#include <pthread.h>
#include <unistd.h>
#include <fcntl.h>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "node.h"

#ifdef GOLTOU_DEBUG_LOGS
static int pipe_out[2];
static int pipe_err[2];

static void* pump(void* arg) {
    int fd = *static_cast<int*>(arg);
    int prio = fd == pipe_err[0] ? ANDROID_LOG_WARN : ANDROID_LOG_INFO;
    char buf[2048];
    ssize_t n;
    while ((n = read(fd, buf, sizeof buf - 1)) > 0) {
        if (buf[n - 1] == '\n') --n;
        buf[n] = 0;
        __android_log_write(prio, "GOLTOU-CORE", buf);
    }
    return nullptr;
}

static void redirect_output() {
    setvbuf(stdout, nullptr, _IONBF, 0);
    setvbuf(stderr, nullptr, _IONBF, 0);
    pipe(pipe_out);
    pipe(pipe_err);
    dup2(pipe_out[1], STDOUT_FILENO);
    dup2(pipe_err[1], STDERR_FILENO);
    pthread_t t1, t2;
    pthread_create(&t1, nullptr, pump, &pipe_out[0]);
    pthread_create(&t2, nullptr, pump, &pipe_err[0]);
    pthread_detach(t1);
    pthread_detach(t2);
}
#else
static void redirect_output() {
    // Suppress even uncaught runtime/library output, which may include URLs or tokens.
    int sink = open("/dev/null", O_WRONLY);
    if (sink < 0) { close(STDOUT_FILENO); close(STDERR_FILENO); return; }
    dup2(sink, STDOUT_FILENO);
    dup2(sink, STDERR_FILENO);
    if (sink > STDERR_FILENO) close(sink);
}
#endif

extern "C" JNIEXPORT jint JNICALL
Java_kr_goltou_auto_NodeRuntime_startNode(JNIEnv* env, jobject, jobjectArray arguments) {
    redirect_output();
    jsize argc = env->GetArrayLength(arguments);
    // libuv requires the arguments in one contiguous block.
    std::vector<std::string> args;
    size_t total = 0;
    for (jsize i = 0; i < argc; i++) {
        auto js = static_cast<jstring>(env->GetObjectArrayElement(arguments, i));
        const char* s = env->GetStringUTFChars(js, nullptr);
        args.emplace_back(s);
        total += strlen(s) + 1;
        env->ReleaseStringUTFChars(js, s);
        env->DeleteLocalRef(js);
    }
    char* block = static_cast<char*>(calloc(total, 1));
    std::vector<char*> argv;
    char* cur = block;
    for (auto& a : args) {
        memcpy(cur, a.c_str(), a.size());
        argv.push_back(cur);
        cur += a.size() + 1;
    }
    return node::Start(static_cast<int>(argv.size()), argv.data());
}

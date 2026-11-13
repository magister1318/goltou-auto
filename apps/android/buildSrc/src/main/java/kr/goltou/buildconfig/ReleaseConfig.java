package kr.goltou.buildconfig;

import java.io.*;
import java.nio.file.Path;
import java.util.Properties;

/** Build-time validation only. Never print signing property values. */
public final class ReleaseConfig {
    public static Properties version(File file) throws IOException {
        Properties values = read(file);
        String code = values.getProperty("versionCode", "");
        String name = values.getProperty("versionName", "");
        if (!code.matches("[1-9][0-9]*") || Long.parseLong(code) > 2100000000L
                || !name.matches("[0-9]+\\.[0-9]+\\.[0-9]+")) {
            throw new IllegalArgumentException("version.properties: valid versionCode/versionName required");
        }
        return values;
    }

    public static Properties signing(File repository, File propertiesFile) throws IOException {
        if (!propertiesFile.isFile()) {
            throw new IllegalArgumentException("Release signing missing: set GOLTOU_SIGNING_PROPERTIES to an external properties file (see docs/release.md). Debug key fallback is forbidden.");
        }
        Path repositoryPath = repository.getCanonicalFile().toPath();
        Path propertiesPath = propertiesFile.getCanonicalFile().toPath();
        Path localPath = repositoryPath.resolve("apps/android/release-signing.properties");
        if (propertiesPath.startsWith(repositoryPath) && !propertiesPath.equals(localPath)) {
            throw new IllegalArgumentException("Signing properties must be external or apps/android/release-signing.properties (gitignored)");
        }
        Properties values = read(propertiesFile);
        for (String key : new String[]{"storeFile", "storePassword", "keyAlias", "keyPassword"}) {
            if (values.getProperty(key, "").isBlank()) {
                throw new IllegalArgumentException("Release signing: missing property " + key + " (see docs/release.md)");
            }
        }
        File store = new File(values.getProperty("storeFile"));
        if (!store.isAbsolute()) store = new File(propertiesFile.getCanonicalFile().getParentFile(), store.getPath());
        Path storePath = store.getCanonicalFile().toPath();
        if (storePath.startsWith(repository.getCanonicalFile().toPath())) {
            throw new IllegalArgumentException("Release keystore must be outside the repository");
        }
        if (!storePath.toFile().isFile()) throw new IllegalArgumentException("Release keystore file missing (see docs/release.md)");
        values.setProperty("storeFile", storePath.toString());
        return values;
    }

    private static Properties read(File file) throws IOException {
        Properties values = new Properties();
        try (InputStream input = new FileInputStream(file)) { values.load(input); }
        return values;
    }

    private ReleaseConfig() {}
}

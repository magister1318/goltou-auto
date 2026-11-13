package kr.goltou.buildconfig;

import java.io.*;
import java.nio.file.Files;
import java.util.Properties;
import org.junit.*;
import org.junit.rules.TemporaryFolder;
import static org.junit.Assert.*;

public class ReleaseConfigTest {
    @Rule public TemporaryFolder temp = new TemporaryFolder();
    private File repo, config, store;
    @Before public void setup() throws Exception {
        repo = temp.newFolder("repo");
        config = temp.newFile("signing.properties");
        store = temp.newFile("throwaway.jks");
    }
    private void write(String text) throws Exception { Files.writeString(config.toPath(), text); }
    private void signing(String path) throws Exception {
        write("storeFile=" + path.replace('\\', '/') + "\nstorePassword=test-only\nkeyAlias=throwaway\nkeyPassword=test-only\n");
    }
    @Test public void readsVersion() throws Exception {
        write("versionCode=12\nversionName=1.2.3\n");
        assertEquals("12", ReleaseConfig.version(config).getProperty("versionCode"));
    }
    @Test public void rejectsInvalidVersions() throws Exception {
        for (String code : new String[]{"0", "-1", "abc", "2100000001"}) {
            write("versionCode=" + code + "\nversionName=1.2.3\n");
            assertThrows(IllegalArgumentException.class, () -> ReleaseConfig.version(config));
        }
        write("versionCode=1\nversionName=\n");
        assertThrows(IllegalArgumentException.class, () -> ReleaseConfig.version(config));
    }
    @Test public void missingConfigFailsClearly() {
        Exception error = assertThrows(IllegalArgumentException.class, () -> ReleaseConfig.signing(repo, new File(repo, "absent")));
        assertTrue(error.getMessage().contains("GOLTOU_SIGNING_PROPERTIES"));
        assertTrue(error.getMessage().contains("Debug key fallback is forbidden"));
    }
    @Test public void rejectsEachMissingSigningValueWithoutPrintingSecrets() throws Exception {
        for (String key : new String[]{"storeFile", "storePassword", "keyAlias", "keyPassword"}) {
            signing(store.getPath());
            Properties values = new Properties();
            try (InputStream input = new FileInputStream(config)) { values.load(input); }
            values.remove(key);
            try (OutputStream output = new FileOutputStream(config)) { values.store(output, null); }
            Exception error = assertThrows(IllegalArgumentException.class, () -> ReleaseConfig.signing(repo, config));
            assertTrue(error.getMessage().contains(key));
            assertFalse(error.getMessage().contains("test-only"));
        }
    }
    @Test public void resolvesRelativeStoreAgainstPropertiesDirectory() throws Exception {
        signing("throwaway.jks");
        assertEquals(store.getCanonicalPath(), ReleaseConfig.signing(repo, config).getProperty("storeFile"));
    }
    @Test public void acceptsAbsoluteExternalStore() throws Exception {
        signing(store.getAbsolutePath());
        assertEquals(store.getCanonicalPath(), ReleaseConfig.signing(repo, config).getProperty("storeFile"));
    }
    @Test public void rejectsKeystoreInsideRepository() throws Exception {
        File internal = new File(repo, "forbidden.jks"); Files.writeString(internal.toPath(), "");
        signing(internal.getAbsolutePath());
        assertThrows(IllegalArgumentException.class, () -> ReleaseConfig.signing(repo, config));
    }
    @Test public void rejectsAbsentKeystore() throws Exception {
        signing("absent.jks");
        assertThrows(IllegalArgumentException.class, () -> ReleaseConfig.signing(repo, config));
    }
    @Test public void rejectsOtherPropertiesInsideRepository() throws Exception {
        signing(store.getAbsolutePath());
        File internal = new File(repo, "signing.properties");
        Files.copy(config.toPath(), internal.toPath());
        assertThrows(IllegalArgumentException.class, () -> ReleaseConfig.signing(repo, internal));
    }
    @Test public void acceptsOnlyTheIgnoredLocalPropertiesPath() throws Exception {
        signing(store.getAbsolutePath());
        File local = new File(repo, "apps/android/release-signing.properties");
        local.getParentFile().mkdirs();
        Files.copy(config.toPath(), local.toPath());
        assertEquals(store.getCanonicalPath(), ReleaseConfig.signing(repo, local).getProperty("storeFile"));
    }
}

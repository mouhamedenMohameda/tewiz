// Minimal ambient types for `@devicefarmer/adbkit-apkreader`. The package
// ships no `.d.ts`; this declaration covers exactly the surface we use in the
// APK upload route (open a file on disk, read its manifest).
declare module '@devicefarmer/adbkit-apkreader' {
  /** Subset of the parsed AndroidManifest we read. */
  interface ApkManifest {
    /** applicationId, e.g. "com.tewiz.app". */
    package?: string;
    /** Human version string, e.g. "1.2.0". */
    versionName?: string;
    /** Monotonic integer build number. */
    versionCode?: number;
    [key: string]: unknown;
  }

  class ApkReader {
    /** Open an APK by absolute file path. */
    static open(apk: string): Promise<ApkReader>;
    /** Parse and return the (binary) AndroidManifest.xml. */
    readManifest(): Promise<ApkManifest>;
  }

  export = ApkReader;
}

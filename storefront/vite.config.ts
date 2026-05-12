import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base: "./" keeps asset URLs relative so the build works from the S3
// website root without any extra configuration.
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "dist",
    assetsDir: "assets",
  },
});

import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { zkLogin } from "sdk/vite";

export default defineConfig({
  plugins: [
    solid(),
    zkLogin({
      vk: fileURLToPath(new URL("../circuits/target/vk", import.meta.url)),
    }),
  ],
});

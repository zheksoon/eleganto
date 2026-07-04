import { defineConfig } from 'tsdown'

export default defineConfig({
    entry: ['./src/index.ts'],
    target: ["es2022"],
    format: ["cjs", "esm"],
    dts: true,
    sourcemap: 'hidden',
    inputOptions: {
        experimental: {
            attachDebugInfo: 'none'
        }
    }
})
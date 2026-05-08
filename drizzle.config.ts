import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/modules/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: './data/app.db'
  }
})

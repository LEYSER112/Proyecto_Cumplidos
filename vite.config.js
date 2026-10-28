import { defineConfig } from 'vite';
const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1] || 'Proyecto_Cumplidos';
export default defineConfig({ base: process.env.GITHUB_ACTIONS ? `/${repositoryName}/` : './' });

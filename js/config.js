/**
 * CONFIG.JS - Configurações da Aplicação Study OS
 */

const CONFIG = {
    // API Configuration
    API: {
        // Quando frontend e backend sao servidos pela mesma origem (dev local
        // ou docker-compose), um caminho relativo funciona direto, sem
        // problema de CORS.
        //
        // Já o GitHub Pages só hospeda arquivos estáticos (não roda o backend
        // Python) — o frontend fica em *.github.io e o backend precisa estar
        // em outro lugar (ex.: Render, veja render.yaml e o README). Nesse
        // caso é preciso a URL completa do backend: troque abaixo pela URL
        // do seu Web Service depois de criá-lo (formato
        // https://SEU-SERVICO.onrender.com).
        BASE_URL: window.location.hostname.endsWith('github.io')
            ? 'https://SEU-SERVICO.onrender.com'
            : '',
        TIMEOUT: 10000,
        ENDPOINTS: {
            // Authentication
            auth: {
                register: '/api/v1/auth/register',
                login: '/api/v1/auth/login',
                me: '/api/v1/auth/me',
                logout: '/api/v1/auth/logout'
            },
            // Subjects
            subjects: '/api/v1/subjects',
            // Notes
            notes: '/api/v1/notes',
            // Tasks
            tasks: '/api/v1/tasks',
            // Study Plans
            studyPlans: '/api/v1/study-plans',
            // Questions
            questions: '/api/v1/questions',
            // Exams
            exams: '/api/v1/exams',
            // Essays
            essays: '/api/v1/essays',
            // AI
            ai: '/api/v1/ai',
            // Stats
            stats: '/api/v1/stats',
            achievements: '/api/v1/achievements',
            leaderboard: '/api/v1/leaderboard'
        }
    },

    // UI Configuration
    UI: {
        theme: 'light',
        sidebarCollapsible: true,
        animationsEnabled: true,
        refreshInterval: 30000 // 30 segundos
    },

    // API pública e gratuita de questões do ENEM (enem.dev)
    // Não precisa de chave/autenticação. Limite: 1 requisição/segundo.
    ENEM_API: {
        BASE_URL: 'https://api.enem.dev/v1',
        TIMEOUT: 15000
    },

    // Feature Flags
    FEATURES: {
        ai_enabled: true,
        ocr_enabled: false,
        premium_features: false,
        offline_mode: true
    },

    // Storage Keys
    STORAGE: {
        token: 'study_os_token',
        user: 'study_os_user',
        theme: 'study_os_theme',
        sidebarState: 'study_os_sidebar',
        language: 'study_os_language'
    },

    // Messages
    MESSAGES: {
        loading: 'Carregando...',
        error: 'Erro ao processar a solicitação',
        success: 'Operação realizada com sucesso',
        unauthorized: 'Você não está autenticado',
        notFound: 'Recurso não encontrado',
        serverError: 'Erro no servidor',
        networkError: 'Erro de conexão'
    },

    // App Metadata
    APP: {
        name: 'Study OS',
        version: '1.0.0',
        description: 'Plataforma Inteligente de Estudos com IA',
        author: 'Study OS Team'
    }
};

// Debug mode
const DEBUG = true;

function log(...args) {
    if (DEBUG) {
        console.log('[Study OS]', ...args);
    }
}

function error(...args) {
    console.error('[Study OS Error]', ...args);
}

function warn(...args) {
    console.warn('[Study OS Warning]', ...args);
}

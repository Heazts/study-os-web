/**
 * STATE.JS - Gerenciamento de estado da aplicação
 */

class StateManager {
    constructor() {
        this.state = {
            user: null,
            isAuthenticated: false,
            currentPage: 'login',
            subjects: [],
            notes: [],
            tasks: [],
            questions: [],
            essays: [],
            exams: [],
            stats: null,
            achievements: null,
            loading: false,
            error: null,
            sidebarOpen: true,
            tasksLoaded: false
        };

        this.listeners = new Set();
        this.loadFromStorage();
        this.initTheme();
    }

    // ========================================
    // Tema (claro / escuro / vidro)
    // ========================================

    /** Lê o tema salvo; sem preferência salva, o escuro é o padrão. */
    getTheme() {
        return localStorage.getItem(CONFIG.STORAGE.theme) || 'dark';
    }

    /** Aplica o tema no <html> (data-theme), persiste a escolha e marca o
     *  estado rastreado (pra Header/Perfil re-renderizarem o ícone/seleção
     *  do próprio controle de tema). */
    applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem(CONFIG.STORAGE.theme, theme);
        this.setState({ theme });
    }

    /** Define um tema específico diretamente (usado pelo seletor no Perfil). */
    setTheme(theme) {
        this.applyTheme(theme);
    }

    /** Alterna entre os 3 temas em sequência (usado pelo botão rápido no cabeçalho). */
    toggleTheme() {
        const order = ['light', 'dark', 'glass'];
        const next = order[(order.indexOf(this.getTheme()) + 1) % order.length];
        this.applyTheme(next);
    }

    /** Chamado uma vez, na construção do estado, antes do primeiro render. */
    initTheme() {
        this.applyTheme(this.getTheme());
    }

    /**
     * Obter estado completo
     */
    getState() {
        return { ...this.state };
    }

    /**
     * Obter valor específico do estado
     */
    get(key) {
        return this.state[key];
    }

    /**
     * Atualizar estado
     */
    setState(updates) {
        const nextState = { ...this.state, ...updates };
        const hasChanged = Object.keys(updates).some((key) => this.state[key] !== nextState[key]);

        if (!hasChanged) {
            return;
        }

        this.state = nextState;
        this.saveToStorage();
        this.notifyListeners();
    }

    /**
     * Atualizar parte específica do estado
     */
    setData(key, value) {
        this.setState({ [key]: value });
    }

    /**
     * Registrar ouvinte para mudanças
     */
    subscribe(listener) {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /**
     * Notificar todos os ouvintes
     */
    notifyListeners() {
        this.listeners.forEach(listener => {
            try {
                listener(this.state);
            } catch (err) {
                error('Erro ao notificar listener:', err);
            }
        });
    }

    /**
     * Carregar dados do localStorage
     */
    loadFromStorage() {
        try {
            const saved = localStorage.getItem(CONFIG.STORAGE.user);
            if (saved) {
                const user = JSON.parse(saved);
                this.state.user = user;
                this.state.isAuthenticated = !!api.getToken();
            }
        } catch (err) {
            warn('Erro ao carregar estado do storage:', err);
        }
    }

    /**
     * Salvar estado no localStorage
     */
    saveToStorage() {
        try {
            if (this.state.user) {
                localStorage.setItem(CONFIG.STORAGE.user, JSON.stringify(this.state.user));
            }
        } catch (err) {
            warn('Erro ao salvar estado no storage:', err);
        }
    }

    /**
     * Limpar estado (logout)
     */
    clear() {
        this.setState({
            user: null,
            isAuthenticated: false,
            currentPage: 'login',
            subjects: [],
            notes: [],
            tasks: [],
            questions: [],
            essays: [],
            exams: [],
            stats: null,
            achievements: null,
            error: null
        });
        localStorage.removeItem(CONFIG.STORAGE.user);
        api.setToken(null);
    }

    /**
     * Definir carregamento
     */
    setLoading(loading) {
        if (this.state.loading === loading) return;
        this.setState({ loading });
    }

    /**
     * Definir erro
     */
    setError(error) {
        if (this.state.error === error) return;
        this.setState({ error });
    }

    /**
     * Limpar erro
     */
    clearError() {
        this.setState({ error: null });
    }

    // ========================================
    // Operações de Autenticação
    // ========================================

    async register(email, password, name, registrationCode) {
        try {
            const response = await api.register(email, password, name, registrationCode);
            const rawUser = response.user || {};
            const user = {
                id: rawUser.id,
                email: rawUser.email,
                name: rawUser.full_name || name,
                avatarUrl: rawUser.avatar_url || null
            };
            this.setState({
                user,
                isAuthenticated: true,
                currentPage: 'dashboard',
                error: null,
                loading: false
            });
            return true;
        } catch (err) {
            this.setState({
                user: null,
                isAuthenticated: false,
                currentPage: 'login',
                error: err.message,
                loading: false
            });
            return false;
        }
    }

    async login(email, password) {
        try {
            const response = await api.login(email, password);
            const rawUser = response.user || {};
            const user = {
                id: rawUser.id,
                email: rawUser.email,
                name: rawUser.full_name || rawUser.username || email,
                avatarUrl: rawUser.avatar_url || null
            };
            this.setState({
                user,
                isAuthenticated: true,
                currentPage: 'dashboard',
                error: null,
                loading: false
            });
            return true;
        } catch (err) {
            this.setState({
                user: null,
                isAuthenticated: false,
                currentPage: 'login',
                error: err.message,
                loading: false
            });
            return false;
        }
    }

    async logout() {
        await api.logout();
        this.clear();
    }

    // ========================================
    // Operações de Dados
    // ========================================

    async loadSubjects() {
        try {
            this.setLoading(true);
            const subjects = await api.getSubjects();
            this.setState({ subjects, error: null });
        } catch (err) {
            this.setError(err.message);
        } finally {
            this.setLoading(false);
        }
    }

    async loadNotes() {
        try {
            this.setLoading(true);
            const notes = await api.getNotes();
            this.setState({ notes, error: null });
        } catch (err) {
            this.setError(err.message);
        } finally {
            this.setLoading(false);
        }
    }

    async loadTasks() {
        if (this.state.tasksLoaded) {
            return this.state.tasks;
        }

        try {
            this.setLoading(true);
            const tasks = await api.getTasks();
            this.setState({ tasks, tasksLoaded: true, error: null });
            return tasks;
        } catch (err) {
            this.setError(err.message);
            return [];
        } finally {
            this.setLoading(false);
        }
    }

    async loadQuestions() {
        try {
            this.setLoading(true);
            const questions = await api.getQuestions();
            this.setState({ questions, error: null });
        } catch (err) {
            this.setError(err.message);
        } finally {
            this.setLoading(false);
        }
    }

    async loadEssays() {
        try {
            this.setLoading(true);
            const essays = await api.getEssays();
            this.setState({ essays, error: null });
        } catch (err) {
            this.setError(err.message);
        } finally {
            this.setLoading(false);
        }
    }

    async loadExams() {
        try {
            this.setLoading(true);
            const exams = await api.getExams();
            this.setState({ exams, error: null });
        } catch (err) {
            this.setError(err.message);
        } finally {
            this.setLoading(false);
        }
    }

    async loadStats() {
        try {
            const [stats, achievements] = await Promise.all([
                api.getStats(),
                api.getAchievements()
            ]);
            this.setState({ stats, achievements, error: null });
        } catch (err) {
            this.setError(err.message);
        }
    }

    /** Marca as estatísticas como desatualizadas (chame após qualquer ação que ganhe XP). */
    invalidateStats() {
        this.setState({ stats: null });
    }
}

// Instância global do estado
const state = new StateManager();

// Função helper para criar elemento
function createElement(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);

    Object.entries(attrs).forEach(([key, value]) => {
        if (value === null || value === undefined) {
            return; // ignora atributos ausentes (ex: icon = null, onClick = null)
        }
        if (key === 'className') {
            el.className = value;
        } else if (key === 'style') {
            Object.assign(el.style, value);
        } else if (key.startsWith('on')) {
            if (typeof value === 'function') {
                const event = key.slice(2).toLowerCase();
                el.addEventListener(event, value);
            }
        } else if (typeof value === 'boolean') {
            // Atributos booleanos do HTML (disabled, checked, required, readonly...):
            // a simples PRESENÇA do atributo já ativa o efeito, mesmo com valor "false".
            // Por isso só podemos usar setAttribute quando value === true.
            if (value) {
                el.setAttribute(key, '');
            } else {
                el.removeAttribute(key);
            }
        } else {
            el.setAttribute(key, value);
        }
    });

    children.forEach(child => {
        if (child === null || child === undefined || child === false) {
            return;
        } else if (typeof child === 'string' || typeof child === 'number') {
            el.appendChild(document.createTextNode(child));
        } else if (child instanceof HTMLElement) {
            el.appendChild(child);
        } else if (Array.isArray(child)) {
            child.forEach(c => {
                if (c === null || c === undefined || c === false) return;
                if (typeof c === 'string' || typeof c === 'number') {
                    el.appendChild(document.createTextNode(c));
                } else if (c instanceof HTMLElement) {
                    el.appendChild(c);
                }
            });
        }
    });

    return el;
}

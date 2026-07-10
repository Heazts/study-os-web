/**
 * API.JS - Módulo de requisições HTTP
 */

class API {
    constructor() {
        this.baseURL = CONFIG.API.BASE_URL;
        this.timeout = CONFIG.API.TIMEOUT;
    }

    /**
     * Fazer requisição HTTP
     */
    async request(endpoint, options = {}) {
        const url = `${this.baseURL}${endpoint}`;
        // timeoutMs deixa uma chamada específica (ex.: correção de redação, que
        // depende de uma API externa) pedir mais tempo do que o padrão — antes
        // esse campo era ignorado e o timeout ficava sempre fixo em
        // CONFIG.API.TIMEOUT (10s), abortando no cliente chamadas que o
        // backend ainda completaria com sucesso alguns segundos depois.
        const { timeoutMs, ...requestOptions } = options;
        const effectiveTimeout = timeoutMs || this.timeout;

        const defaultOptions = {
            headers: {
                'Content-Type': 'application/json',
                ...this.getAuthHeaders()
            }
        };

        const finalOptions = {
            ...defaultOptions,
            ...requestOptions,
            headers: {
                ...defaultOptions.headers,
                ...(requestOptions.headers || {})
            }
        };

        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), effectiveTimeout);

            const response = await fetch(url, {
                ...finalOptions,
                signal: controller.signal
            });

            clearTimeout(timeout);

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const friendlyDetail = Array.isArray(errorData.detail)
                    ? errorData.detail.map(d => d.msg).join(', ')
                    : errorData.detail;
                throw new APIError(response.status, friendlyDetail || errorData.message || CONFIG.MESSAGES.error);
            }

            if (response.status === 204 || response.headers.get('content-length') === '0') {
                return {};
            }

            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
                return await response.json();
            }

            return await response.text();
        } catch (err) {
            if (err instanceof APIError) {
                throw err;
            }
            if (err.name === 'AbortError') {
                throw new APIError(0, 'O servidor demorou demais para responder. Tente novamente.');
            }
            // "Failed to fetch" / erro de rede geralmente significa que o
            // backend não está rodando ou a URL em config.js está errada.
            throw new APIError(0, `Não foi possível conectar ao servidor (${this.baseURL}). Verifique se o backend está rodando.`);
        }
    }

    /**
     * GET request
     */
    async get(endpoint, options = {}) {
        return this.request(endpoint, {
            method: 'GET',
            ...options
        });
    }

    /**
     * POST request
     */
    async post(endpoint, data = {}, options = {}) {
        return this.request(endpoint, {
            method: 'POST',
            body: JSON.stringify(data),
            ...options
        });
    }

    /**
     * PUT request
     */
    async put(endpoint, data = {}, options = {}) {
        return this.request(endpoint, {
            method: 'PUT',
            body: JSON.stringify(data),
            ...options
        });
    }

    /**
     * DELETE request
     */
    async delete(endpoint, options = {}) {
        return this.request(endpoint, {
            method: 'DELETE',
            ...options
        });
    }

    /**
     * Obter headers de autenticação
     */
    getAuthHeaders() {
        const token = localStorage.getItem(CONFIG.STORAGE.token);
        if (token) {
            return { 'Authorization': `Bearer ${token}` };
        }
        return {};
    }

    /**
     * Definir token de autenticação
     */
    setToken(token) {
        if (token) {
            localStorage.setItem(CONFIG.STORAGE.token, token);
        } else {
            localStorage.removeItem(CONFIG.STORAGE.token);
        }
    }

    /**
     * Obter token atual
     */
    getToken() {
        return localStorage.getItem(CONFIG.STORAGE.token);
    }

    /**
     * Verificar se está autenticado
     */
    isAuthenticated() {
        return !!this.getToken();
    }

    // ========================================
    // AUTENTICAÇÃO
    // ========================================

    async register(email, password, name, registrationCode) {
        // O backend exige email, username e full_name. Usamos o próprio
        // email como username (a UI só pede email, então isso é transparente
        // para quem está usando a plataforma).
        const created = await this.post(CONFIG.API.ENDPOINTS.auth.register, {
            email,
            username: email,
            full_name: name,
            password,
            registration_code: registrationCode
        });

        // O endpoint de registro não devolve token — fazemos login em
        // seguida para autenticar automaticamente quem acabou de se cadastrar.
        const session = await this.login(email, password);
        return { user: created, ...session };
    }

    async login(email, password) {
        // O backend usa OAuth2PasswordRequestForm: exige corpo
        // application/x-www-form-urlencoded com os campos "username" e
        // "password" (não JSON, e o campo se chama "username" mesmo
        // recebendo um email).
        const body = new URLSearchParams();
        body.append('username', email);
        body.append('password', password);

        const data = await this.request(CONFIG.API.ENDPOINTS.auth.login, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString()
        });

        if (data.access_token) {
            this.setToken(data.access_token);
        }
        return data;
    }

    async getCurrentUser() {
        return this.get(CONFIG.API.ENDPOINTS.auth.me);
    }

    /** Atualiza nome/email do perfil (update parcial - só envia o que foi passado) */
    async updateProfile(data) {
        return this.put(CONFIG.API.ENDPOINTS.auth.me, data);
    }

    /** Troca a senha do usuário autenticado */
    async changePassword(currentPassword, newPassword) {
        return this.post('/api/v1/auth/change-password', {
            current_password: currentPassword,
            new_password: newPassword
        });
    }

    /** Envia uma foto de perfil (multipart) — não usa this.post() pq o browser
     *  precisa definir sozinho o Content-Type com o boundary do multipart. */
    async uploadAvatar(file) {
        const url = `${this.baseURL}/api/v1/auth/me/avatar`;
        const formData = new FormData();
        formData.append('file', file);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeout);

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: this.getAuthHeaders(),
                body: formData,
                signal: controller.signal
            });
            clearTimeout(timeout);

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new APIError(response.status, errorData.detail || 'Não foi possível enviar a imagem.');
            }
            return await response.json();
        } catch (err) {
            clearTimeout(timeout);
            if (err instanceof APIError) throw err;
            if (err.name === 'AbortError') {
                throw new APIError(0, 'O envio da imagem demorou demais. Tente novamente.');
            }
            throw new APIError(0, 'Não foi possível conectar ao servidor para enviar a imagem.');
        }
    }

    async logout() {
        this.setToken(null);
        localStorage.removeItem(CONFIG.STORAGE.user);
    }

    // ========================================
    // SUBJECTS
    // ========================================

    async getSubjects() {
        return this.get(CONFIG.API.ENDPOINTS.subjects);
    }

    async createSubject(name, color, icon) {
        return this.post(CONFIG.API.ENDPOINTS.subjects, { name, color, icon });
    }

    async deleteSubject(id) {
        return this.delete(`${CONFIG.API.ENDPOINTS.subjects}/${id}`);
    }

    // ========================================
    // NOTES
    // ========================================

    async getNotes() {
        return this.get(CONFIG.API.ENDPOINTS.notes);
    }

    async createNote(subject_id, title, content) {
        return this.post(CONFIG.API.ENDPOINTS.notes, {
            subject_id,
            title,
            content
        });
    }

    async updateNote(id, data) {
        return this.put(`${CONFIG.API.ENDPOINTS.notes}/${id}`, data);
    }

    async deleteNote(id) {
        return this.delete(`${CONFIG.API.ENDPOINTS.notes}/${id}`);
    }

    async summarizeNote(id) {
        return this.post(`${CONFIG.API.ENDPOINTS.notes}/${id}/summarize`);
    }

    // ========================================
    // TASKS
    // ========================================

    async getTasks() {
        return this.get(CONFIG.API.ENDPOINTS.tasks);
    }

    async createTask(title, subject_id, due_date, priority) {
        return this.post(CONFIG.API.ENDPOINTS.tasks, {
            title,
            subject_id,
            due_date,
            priority
        });
    }

    async updateTask(id, data) {
        return this.put(`${CONFIG.API.ENDPOINTS.tasks}/${id}`, data);
    }

    async completeTask(id) {
        return this.put(`${CONFIG.API.ENDPOINTS.tasks}/${id}/complete`);
    }

    async deleteTask(id) {
        return this.delete(`${CONFIG.API.ENDPOINTS.tasks}/${id}`);
    }

    // ========================================
    // STUDY PLANS
    // ========================================

    async getStudyPlans() {
        return this.get(CONFIG.API.ENDPOINTS.studyPlans);
    }

    async createStudyPlan(data) {
        return this.post(CONFIG.API.ENDPOINTS.studyPlans, data);
    }

    // ========================================
    // QUESTIONS
    // ========================================

    async getQuestions(filters = {}) {
        const params = new URLSearchParams(filters);
        return this.get(`${CONFIG.API.ENDPOINTS.questions}?${params}`);
    }

    async analyzeQuestion(id, selectedOption) {
        return this.post(`${CONFIG.API.ENDPOINTS.questions}/${id}/analyze`, {
            question_id: id,
            selected_option: selectedOption
        });
    }

    // ========================================
    // EXAMS
    // ========================================

    async getExams() {
        return this.get(CONFIG.API.ENDPOINTS.exams);
    }

    async createExam(data) {
        return this.post(CONFIG.API.ENDPOINTS.exams, data);
    }

    async updateExam(id, data) {
        return this.put(`${CONFIG.API.ENDPOINTS.exams}/${id}`, data);
    }

    async deleteExam(id) {
        return this.delete(`${CONFIG.API.ENDPOINTS.exams}/${id}`);
    }

    // ========================================
    // ESSAYS
    // ========================================

    async getEssays() {
        return this.get(CONFIG.API.ENDPOINTS.essays);
    }

    async createEssay(data) {
        return this.post(CONFIG.API.ENDPOINTS.essays, data);
    }

    async updateEssay(id, data) {
        return this.put(`${CONFIG.API.ENDPOINTS.essays}/${id}`, data);
    }

    async deleteEssay(id) {
        return this.delete(`${CONFIG.API.ENDPOINTS.essays}/${id}`);
    }

    async correctEssay(id) {
        // Esta chamada faz o backend consultar um serviço externo de correção
        // gramatical antes de responder - precisa de mais tempo do que o
        // timeout padrão (10s), que abortava no cliente antes do backend
        // terminar (mesmo quando ele ia terminar com sucesso pouco depois).
        return this.post(`${CONFIG.API.ENDPOINTS.essays}/${id}/correct`, {}, { timeoutMs: 25000 });
    }

    // ========================================
    // AI
    // ========================================

    async explainContent(content, level = 'intermediate') {
        return this.post(`${CONFIG.API.ENDPOINTS.ai}/explain`, {
            content,
            level
        });
    }

    async summarizeText(content) {
        return this.post(`${CONFIG.API.ENDPOINTS.ai}/summarize`, { content });
    }

    async generateFlashcards(content) {
        return this.post(`${CONFIG.API.ENDPOINTS.ai}/flashcards`, { content });
    }

    // ========================================
    // STATS
    // ========================================

    async getStats() {
        return this.get(CONFIG.API.ENDPOINTS.stats);
    }

    async getAchievements() {
        return this.get(CONFIG.API.ENDPOINTS.achievements);
    }

    async getLeaderboard() {
        return this.get(CONFIG.API.ENDPOINTS.leaderboard);
    }

    // ========================================
    // ENEM (API pública externa, sem autenticação)
    // ========================================

    async _enemRequest(path) {
        const url = `${CONFIG.ENEM_API.BASE_URL}${path}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), CONFIG.ENEM_API.TIMEOUT);

        try {
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeout);

            if (response.status === 429) {
                throw new APIError(429, 'Muitas requisições ao banco de questões do ENEM. Aguarde alguns segundos e tente de novo.');
            }
            if (!response.ok) {
                throw new APIError(response.status, 'Não foi possível carregar as questões do ENEM agora.');
            }
            return await response.json();
        } catch (err) {
            clearTimeout(timeout);
            if (err instanceof APIError) throw err;
            if (err.name === 'AbortError') {
                throw new APIError(0, 'O banco de questões do ENEM demorou demais para responder.');
            }
            throw new APIError(0, 'Não foi possível conectar à API do ENEM. Verifique sua internet.');
        }
    }

    /** Lista as provas disponíveis (ano, disciplinas e idiomas de cada uma) */
    async getEnemExams() {
        return this._enemRequest('/exams');
    }

    /** Lista questões de uma prova por ano. A API pública aceita até 50 por requisição.
     *  Tenta de novo (com espera crescente) em erros passageiros (429 "muitas
     *  requisições", 5xx do servidor, timeout/rede) — sem isso, um simulado de
     *  prova completa (várias dezenas de requisições em sequência) falhava por
     *  inteiro se UMA única página desse erro no meio do caminho, mesmo que as
     *  páginas anteriores já tivessem carregado com sucesso. Confirmado na prática:
     *  bati um 429 de verdade testando esta mesma API pública. */
    async getEnemQuestions(year, { limit = 50, offset = 0, language = null } = {}) {
        const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 50);
        const params = new URLSearchParams({ limit: String(safeLimit), offset: String(offset) });
        if (language) params.append('language', language);

        const maxRetries = 3;
        for (let attempt = 0; ; attempt++) {
            try {
                return await this._enemRequest(`/exams/${year}/questions?${params.toString()}`);
            } catch (err) {
                const isRetryable = err instanceof APIError && (err.status === 429 || err.status === 0 || err.status >= 500);
                if (!isRetryable || attempt >= maxRetries) throw err;
                await new Promise(resolve => setTimeout(resolve, 1500 * (attempt + 1)));
            }
        }
    }

    /**
     * Busca TODAS as questões de uma prova, paginando automaticamente (a API só
     * devolve até 50 por requisição). Necessário porque as disciplinas não vêm
     * distribuídas nas primeiras páginas — filtrar sem paginar tudo faz com que
     * áreas como Matemática pareçam não ter nenhuma questão.
     *
     * onProgress(loaded, total), se passado, é chamado a cada página carregada —
     * usado pra mostrar "Carregando... (120/183)" em vez de um spinner cego
     * durante o carregamento de uma prova completa (que pode levar alguns
     * segundos por causa do limite de 1 req/s da API pública).
     */
    async getAllEnemQuestions(year, { language = null, onProgress = null } = {}) {
        const first = await this.getEnemQuestions(year, { limit: 50, offset: 0, language });
        let all = Array.isArray(first) ? first : (first.questions || []);
        const total = Array.isArray(first) ? all.length : (first.metadata?.total ?? all.length);
        if (onProgress) onProgress(all.length, total);

        let offset = all.length;
        while (offset < total) {
            // respeita o limite de 1 requisição/segundo da API pública
            await new Promise(resolve => setTimeout(resolve, 1100));
            const page = await this.getEnemQuestions(year, { limit: 50, offset, language });
            const pageList = Array.isArray(page) ? page : (page.questions || []);
            if (pageList.length === 0) break;
            all = all.concat(pageList);
            offset += pageList.length;
            if (onProgress) onProgress(all.length, total);
        }
        return all;
    }

    /** Registra no nosso backend a resposta de uma questão do simulado ENEM
     *  (usado pras estatísticas reais — isso é diferente da API pública do
     *  ENEM, que não sabe nada sobre nossos usuários). */
    async recordEnemAttempt(data) {
        return this.post('/api/v1/enem/attempts', data);
    }

    /** Estatísticas agregadas e reais do desempenho do usuário no simulado ENEM. */
    async getEnemStats() {
        return this.get('/api/v1/enem/stats');
    }

    /** Registra um simulado ENEM finalizado (chamado uma vez, ao encerrar) —
     *  alimenta o histórico de simulados, diferente de recordEnemAttempt (que
     *  é por questão) e getEnemStats (que é agregado por disciplina, sem
     *  noção de "simulados" individuais ao longo do tempo). */
    async recordEnemSimulado(data) {
        return this.post('/api/v1/enem/simulados', data);
    }

    /** Histórico dos últimos simulados finalizados do usuário, mais recente primeiro. */
    async getEnemSimulados(limit = 20) {
        return this.get(`/api/v1/enem/simulados?limit=${limit}`);
    }
}

/**
 * Classe de erro da API
 */
class APIError extends Error {
    constructor(status, message) {
        super(message);
        this.name = 'APIError';
        this.status = status;
    }
}

// Instância global da API
const api = new API();

/**
 * APP.JS - Arquivo principal da aplicação
 */

class App {
    constructor() {
        this.root = document.getElementById('root');
        this.currentScreen = null;
        this.renderScheduled = false;
        this.pendingState = null;
        this.lastRenderedState = null;
        this.setupEventListeners();
        this.subscribeToStateChanges();
    }

    /**
     * Configurar event listeners globais
     */
    setupEventListeners() {
        // Menu toggle para mobile
        document.addEventListener('click', (e) => {
            if (e.target.closest('#menu-toggle')) {
                this.toggleMobileSidebar();
            }
        });

        // Fecha o menu mobile com a tecla Esc
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeMobileSidebar();
            }
        });

        // User menu
        document.addEventListener('click', (e) => {
            if (e.target.closest('#user-menu')) {
                // Redirecionar para perfil
                state.setState({ currentPage: 'profile' });
            }
        });
    }

    toggleMobileSidebar() {
        const sidebar = document.querySelector('.sidebar');
        if (!sidebar) return;
        const isOpen = sidebar.classList.toggle('open');
        if (isOpen) {
            document.body.style.overflow = 'hidden';
            const backdrop = createElement('div', {
                className: 'sidebar-backdrop',
                id: 'sidebar-backdrop',
                onClick: () => this.closeMobileSidebar()
            });
            document.body.appendChild(backdrop);
        } else {
            this.closeMobileSidebar();
        }
    }

    closeMobileSidebar() {
        const sidebar = document.querySelector('.sidebar');
        if (sidebar) sidebar.classList.remove('open');
        document.body.style.overflow = '';
        const backdrop = document.getElementById('sidebar-backdrop');
        if (backdrop) backdrop.remove();
    }

    /**
     * Inscrever para mudanças de estado
     */
    subscribeToStateChanges() {
        state.subscribe((nextState) => {
            this.scheduleRender(nextState);
        });
    }

    scheduleRender(nextState = state.getState()) {
        this.pendingState = nextState;
        if (this.renderScheduled) return;
        this.renderScheduled = true;
        requestAnimationFrame(() => {
            this.renderScheduled = false;
            const currentState = this.pendingState || state.getState();
            this.pendingState = null;
            this.render(currentState);
        });
    }

    shouldSkipRender(nextState, previousState) {
        if (!previousState) return false;

        // Antes esta função checava só uma lista fixa de campos (user, loading,
        // error, stats.streak_days, tasks.length...). Qualquer campo fora dessa
        // lista — _notesLoaded, _subjectsLoaded, _essaysLoaded, _examsLoaded,
        // subjects, essays, exams, ou até o conteúdo de "notes"/"tasks" quando só
        // o length não mudava — não disparava um redesenho de verdade. Resultado:
        // criar uma anotação/matéria/tarefa/redação/prova "funcionava" (a chamada
        // à API ia com sucesso), mas a tela só mostrava o item novo depois de
        // navegar pra outra página e voltar (o que muda currentPage, forçando o
        // redesenho). Comparando TODAS as chaves do estado — genericamente, sem
        // precisar lembrar de listar cada uma — esse bug inteiro fica corrigido
        // de uma vez, e continua corrigido para qualquer campo de estado futuro.
        const keys = new Set([...Object.keys(previousState), ...Object.keys(nextState)]);
        for (const key of keys) {
            if (!Object.is(previousState[key], nextState[key])) {
                return false;
            }
        }
        return true;
    }

    /**
     * Renderizar aplicação
     */
    render(nextState = state.getState()) {
        const currentState = nextState;

        if (this.shouldSkipRender(currentState, this.lastRenderedState)) {
            return;
        }

        // Preserva a posição de rolagem do conteúdo — o DOM inteiro é recriado a
        // cada render (innerHTML = ''), então sem isso a tela sempre "pula" pro
        // topo a cada clique (ex.: responder uma questão do simulado). Só
        // restaura quando a página continua a mesma; ao navegar pra outra tela
        // o normal é começar do topo.
        const samePage = this.lastRenderedState && this.lastRenderedState.currentPage === currentState.currentPage;
        const previousMain = this.root.querySelector('.app-main-scroll');
        const previousScrollTop = (samePage && previousMain) ? previousMain.scrollTop : 0;

        // Limpar root
        this.root.innerHTML = '';

        // Se não autenticado, mostrar login/register
        if (!currentState.isAuthenticated) {
            if (currentState.currentPage === 'register') {
                this.root.appendChild(Screens.RegisterScreen());
            } else {
                this.root.appendChild(Screens.LoginScreen());
            }
            return;
        }

        // Layout com sidebar e main
        const layout = createElement('div', { className: 'flex h-screen bg-[var(--surface)]' });

        // Sidebar
        const sidebarItems = [
            { id: 'dashboard', label: 'Dashboard', icon: 'home' },
            { id: 'subjects', label: 'Matérias', icon: 'layer-group' },
            { id: 'notes', label: 'Anotações', icon: 'sticky-note' },
            { id: 'tasks', label: 'Tarefas', icon: 'tasks' },
            { id: 'questions', label: 'Questões', icon: 'question-circle' },
            { id: 'essays', label: 'Redações', icon: 'pen-fancy' },
            { id: 'exams', label: 'Provas', icon: 'file-alt' },
            { id: 'stats', label: 'Estatísticas', icon: 'chart-line' },
            { id: 'profile', label: 'Perfil', icon: 'user' }
        ];

        const sidebar = Components.Sidebar(
            sidebarItems.map(item => ({
                ...item,
                active: item.id === currentState.currentPage
            }))
        );
        layout.appendChild(sidebar);

        // Main content
        const main = createElement('div', { className: 'flex-1 flex flex-col overflow-y-auto app-main-scroll' });

        // O simulado de Questões registra um listener de teclado em `document`
        // (ver QuestionsScreen). Remove aqui incondicionalmente antes de decidir
        // a tela: se formos renderizar Questões de novo, ela recria o listener
        // na hora; se formos pra qualquer outra tela, ele só some (sem isso,
        // ficaria preso pra sempre respondendo a teclas fora da tela de Questões).
        Screens.teardownEnemKeydown();

        let screenComponent;
        switch (currentState.currentPage) {
            case 'subjects':
                screenComponent = Screens.SubjectsScreen();
                break;
            case 'notes':
                screenComponent = Screens.NotesScreen();
                break;
            case 'tasks':
                screenComponent = Screens.TasksScreen();
                break;
            case 'questions':
                screenComponent = Screens.QuestionsScreen();
                break;
            case 'essays':
                screenComponent = Screens.EssaysScreen();
                break;
            case 'exams':
                screenComponent = Screens.ExamsScreen();
                break;
            case 'stats':
                screenComponent = Screens.StatsScreen();
                break;
            case 'profile':
                screenComponent = Screens.ProfileScreen();
                break;
            default:
                screenComponent = Screens.DashboardScreen();
        }

        main.appendChild(screenComponent);
        layout.appendChild(main);

        this.root.appendChild(layout);
        this.lastRenderedState = { ...currentState };

        if (previousScrollTop > 0) {
            main.scrollTop = previousScrollTop;
        }
    }

    /**
     * Iniciar aplicação
     */
    async init() {
        try {
            // Verificar se existe token
            if (api.isAuthenticated()) {
                state.setLoading(true);
                // Tentar carregar dados do usuário
                const user = await api.getCurrentUser();
                state.setState({
                    user: {
                        id: user.id,
                        email: user.email,
                        name: user.full_name || user.username,
                        avatarUrl: user.avatar_url || null
                    },
                    isAuthenticated: true,
                    currentPage: 'dashboard'
                });
            }
        } catch (err) {
            warn('Erro ao carregar usuário:', err.message);
            api.setToken(null);
        } finally {
            state.setLoading(false);
            this.render();
        }
    }
}

// Instância global da aplicação
const app = new App();

// Iniciar quando o DOM estiver pronto
document.addEventListener('DOMContentLoaded', () => {
    app.init();
});

// Exportar para uso em outros scripts
window.app = app;
window.state = state;
window.api = api;
window.Components = Components;
window.Screens = Screens;

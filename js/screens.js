/**
 * SCREENS.JS - Telas/páginas da aplicação
 */

// Flags para evitar disparar múltiplas requisições simultâneas quando o
// mesmo componente é re-renderizado (toda mudança de estado re-renderiza a tela atual)
let _statsFetchInFlight = false;
let _tasksFetchInFlight = false;
let _tasksScreenFetchInFlight = false;
let _notesFetchInFlight = false;
let _statsScreenFetchInFlight = false;
let _essaysFetchInFlight = false;
let _examsFetchInFlight = false;
let _dashboardTasksLoaded = false;
let _dashboardStatsLoaded = false;
let _profileStatsFetchInFlight = false;
let _subjectsFetchInFlight = false;
let _enemStatsFetchInFlight = false;
let _enemHistoryFetchInFlight = false;

const SUBJECT_COLORS = ['#D54141', '#6C5CE7', '#278262', '#4A90D9', '#E6AC12', '#17213A'];
const SUBJECT_ICONS = ['book', 'flask', 'calculator', 'globe-americas', 'landmark', 'language', 'atom', 'palette'];

// O backend guarda a prioridade da tarefa em inglês ('low'/'medium'/'high') —
// sem essa tradução, o Badge (que deixa o texto em CAIXA ALTA) mostrava
// "HIGH"/"MEDIUM"/"LOW" na tela, quebrando o português do resto do app.
const TASK_PRIORITY_LABELS = { low: 'Baixa', medium: 'Média', high: 'Alta' };
const TASK_PRIORITY_OPTIONS = [
    { value: 'low', label: 'Baixa' },
    { value: 'medium', label: 'Média' },
    { value: 'high', label: 'Alta' }
];

/** Garante que as matérias do usuário estejam carregadas em state.subjects
 *  (usado pela tela de Matérias e pelos formulários de Anotação/Tarefa, que
 *  precisam da lista para o seletor de matéria). */
function ensureSubjectsLoaded() {
    if (!_subjectsFetchInFlight && !state.get('_subjectsLoaded')) {
        _subjectsFetchInFlight = true;
        state.loadSubjects().finally(() => {
            _subjectsFetchInFlight = false;
            state.setState({ _subjectsLoaded: true });
        });
    }
}

/** Monta o <select> de matéria (opcional) usado nos formulários de Anotação/Tarefa.
 *  currentValue pré-seleciona uma matéria (usado ao editar um item existente). */
function buildSubjectSelect(subjects, currentValue = '') {
    const options = [{ value: '', label: 'Sem matéria' }].concat(
        subjects.map(s => ({ value: String(s.id), label: s.name }))
    );
    return Components.Select('Matéria (opcional)', options, currentValue, null);
}

/** Classifica a urgência de uma tarefa pendente pela data de entrega, comparando
 *  só o dia (não a hora) — 'overdue' se o prazo já passou, 'today' se vence hoje,
 *  ou null (sem prazo, já concluída, ou prazo ainda distante). Usado em
 *  TasksScreen/DashboardScreen para destacar o que precisa de atenção. */
function getTaskUrgency(task) {
    if (!task.due_date || task.status === 'completed') return null;
    const due = new Date(task.due_date);
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dueStart = new Date(due.getFullYear(), due.getMonth(), due.getDate());
    if (dueStart < todayStart) return 'overdue';
    if (dueStart.getTime() === todayStart.getTime()) return 'today';
    return null;
}

// Contador usado para forçar redesenho do simulado ENEM (ver rerender() dentro
// de QuestionsScreen) — um contador incremental nunca colide, diferente de
// Date.now(), que pode repetir o mesmo milissegundo em chamadas seguidas.
let _enemTickCounter = 0;

// Atalho de teclado do simulado ENEM: um único listener em `document`,
// substituído a cada render (nunca acumulado) e removido ao sair da tela via
// Screens.teardownEnemKeydown (chamado por App.render antes de trocar de
// página) — ver QuestionsScreen.
let _enemKeydownHandler = null;

// Estado do simulado de questões do ENEM. A navegação/UI vive só aqui
// (efêmera), mas cada resposta é replicada pro backend (ver selectAnswer) para
// alimentar estatísticas reais de desempenho por área/ano.
const _enemState = {
    exams: null,          // lista de provas disponíveis (ano, disciplinas)
    examsError: null,
    loadingExams: false,
    year: null,
    discipline: null,
    quantity: 10,
    questions: [],
    loadingQuestions: false,
    questionsError: null,
    currentIndex: 0,
    questionStartedAt: null, // Date.now() de quando a questão atual apareceu (pra medir tempo de resposta)
    answers: {},           // { [questionIndex]: letraEscolhida }
    crossedOut: {},        // { [questionIndex]: { [letra]: true } } — alternativas "cortadas"
    started: false,
    finished: false,       // true quando o usuário encerrou o simulado (ver resultado)
    totalTimeSpent: 0,     // segundos acumulados respondendo (soma do tempo de cada questão)
    loadingProgress: null, // { loaded, total } durante o carregamento de uma prova completa
    simuladoRecorded: false, // evita registrar o mesmo simulado 2x no histórico (ver finishQuiz)
    reviewMode: false,     // true quando o usuário está revisando as questões erradas/puladas
    reviewIndices: [],     // índices (em `questions`) das questões erradas/puladas, na ordem de revisão
    history: null,         // últimos simulados finalizados (ver histórico, tela de configuração)
    historyLoaded: false
};

const ENEM_STATE_STORAGE_KEY = 'study_os_enem_progress';

// Restaura o simulado em andamento se a página foi recarregada no meio do
// caminho (sessionStorage — some ao fechar a aba, diferente de localStorage).
// Sem isso, um F5 sem querer no meio de uma prova completa jogava fora todo o
// progresso (questões já carregadas, respostas já dadas).
try {
    const savedEnemState = sessionStorage.getItem(ENEM_STATE_STORAGE_KEY);
    if (savedEnemState) {
        const parsed = JSON.parse(savedEnemState);
        Object.assign(_enemState, parsed, {
            // Flags de "carregando" nunca devem sobreviver a um reload: não há
            // nenhuma requisição de verdade em andamento logo após restaurar.
            loadingExams: false,
            loadingQuestions: false,
            loadingProgress: null,
            questionStartedAt: Date.now()
        });
    }
} catch (err) {
    warn('Não foi possível restaurar o progresso do simulado ENEM:', err.message);
}

/** Persiste o estado atual do simulado no sessionStorage (ver rerender() em
 *  QuestionsScreen). Falha em silêncio se o storage estiver cheio/indisponível
 *  — isso é só uma conveniência de recuperação, não deve travar o simulado. */
function persistEnemState() {
    try {
        sessionStorage.setItem(ENEM_STATE_STORAGE_KEY, JSON.stringify(_enemState));
    } catch (err) {
        warn('Não foi possível salvar o progresso do simulado ENEM:', err.message);
    }
}

/** Formata segundos como "12min 34s" (ou só "34s" se menos de um minuto). */
function formatDuration(totalSeconds) {
    const seconds = Math.max(0, Math.round(totalSeconds));
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return minutes > 0 ? `${minutes}min ${remainder}s` : `${remainder}s`;
}

// A API pública do ENEM às vezes embute imagens como markdown puro dentro do
// próprio texto (ex.: "![](https://enem.dev/.../foo.png)") em vez de usar o
// campo "files" — sem isso, esse trecho aparecia como texto cru na tela em
// vez de mostrar a imagem. Essa função separa o texto em pedaços de texto e
// elementos <img>, preservando a ordem original.
function renderTextWithImages(text) {
    if (!text) return null;
    const regex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    const parts = [];
    let lastIndex = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            parts.push(createElement('span', { style: { whiteSpace: 'pre-line' } }, text.slice(lastIndex, match.index)));
        }
        parts.push(createElement('img', {
            src: match[2],
            alt: match[1] || 'Imagem da questão',
            className: 'enem-question-img',
            loading: 'lazy'
        }));
        lastIndex = regex.lastIndex;
    }
    if (lastIndex < text.length) {
        parts.push(createElement('span', { style: { whiteSpace: 'pre-line' } }, text.slice(lastIndex)));
    }
    return parts;
}

const ENEM_FALLBACK_DISCIPLINES = [
    { label: 'Linguagens, Códigos e suas Tecnologias', value: 'linguagens' },
    { label: 'Ciências Humanas e suas Tecnologias', value: 'ciencias-humanas' },
    { label: 'Ciências da Natureza e suas Tecnologias', value: 'ciencias-natureza' },
    { label: 'Matemática e suas Tecnologias', value: 'matematica' }
];
const ENEM_FALLBACK_YEARS = [2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015];

const Screens = {
    // ========================================
    // LOGIN SCREEN
    // ========================================

    LoginScreen: () => {
        const container = createElement('div', { className: 'auth-shell' });
        const card = createElement('div', { className: 'auth-card animate-slide-in' });

        card.appendChild(createElement('h1', { className: 'display-face' }, 'Bem-vindo de volta'));
        card.appendChild(createElement('p', { className: 'sub' }, 'Retome seus estudos de onde parou.'));

        const form = createElement('form', { className: 'space-y-4' });

        const emailInput = Components.Input('Email', 'email', 'seu@email.com', '', null, 'envelope');
        const passwordInput = Components.Input('Senha', 'password', '••••••••', '', null, 'lock');
        const emailField = emailInput.querySelector('input');
        const passwordField = passwordInput.querySelector('input');

        form.appendChild(emailInput);
        form.appendChild(passwordInput);

        let loginBtn = null;
        let isSubmitting = false;

        const updateLoginButtonState = () => {
            const isValid = emailField.value.trim() && passwordField.value.trim();
            const shouldDisable = !isValid || isSubmitting;
            loginBtn.disabled = shouldDisable;
            loginBtn.classList.toggle('disabled', shouldDisable);
            loginBtn.setAttribute('aria-disabled', shouldDisable ? 'true' : 'false');
        };

        const handleLogin = async () => {
            const email = emailField.value.trim();
            const password = passwordField.value;

            if (!email || !password) {
                Components.Toast('Preencha email e senha para continuar', 'warning');
                return;
            }

            if (isSubmitting) return;

            isSubmitting = true;
            updateLoginButtonState();

            try {
                const success = await state.login(email, password);
                if (success) {
                    Components.Toast('Login realizado. Bons estudos!', 'success');
                } else {
                    Components.Toast(state.get('error') || 'Não foi possível entrar', 'error');
                }
            } finally {
                isSubmitting = false;
                updateLoginButtonState();
            }
        };

        loginBtn = Components.Button('Entrar', handleLogin, 'primary', 'large');
        loginBtn.type = 'submit';
        loginBtn.className = 'w-full btn btn-primary';
        loginBtn.style.justifyContent = 'center';
        loginBtn.style.padding = '14px 26px';

        emailField.addEventListener('input', updateLoginButtonState);
        passwordField.addEventListener('input', updateLoginButtonState);
        updateLoginButtonState();

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            handleLogin();
        });

        form.appendChild(loginBtn);

        const registerLink = createElement('p', { className: 'auth-switch' },
            'Ainda não tem conta? ',
            createElement('button', {
                type: 'button',
                onClick: () => state.setState({ currentPage: 'register' })
            }, 'Criar agora')
        );

        form.appendChild(registerLink);
        card.appendChild(form);
        container.appendChild(card);

        return container;
    },

    // ========================================
    // REGISTER SCREEN
    // ========================================

    RegisterScreen: () => {
        const container = createElement('div', { className: 'auth-shell' });
        const card = createElement('div', { className: 'auth-card animate-slide-in' });

        card.appendChild(createElement('h1', { className: 'display-face' }, 'Crie sua conta'));
        card.appendChild(createElement('p', { className: 'sub' }, 'Leva menos de um minuto para começar.'));

        const form = createElement('form', { className: 'space-y-4' });

        const nameInput = Components.Input('Nome completo', 'text', 'Como podemos te chamar?', '', null, 'user');
        const emailInput = Components.Input('Email', 'email', 'seu@email.com', '', null, 'envelope');
        const passwordInput = Components.Input('Senha', 'password', 'Mínimo 8 caracteres', '', null, 'lock');

        const nameField = nameInput.querySelector('input');
        const emailField = emailInput.querySelector('input');
        const passwordField = passwordInput.querySelector('input');

        form.appendChild(nameInput);
        form.appendChild(emailInput);
        form.appendChild(passwordInput);

        let registerBtn = null;
        let isSubmitting = false;

        const updateRegisterButtonState = () => {
            const isValid = nameField.value.trim() && emailField.value.trim() && passwordField.value.trim().length >= 8;
            const shouldDisable = !isValid || isSubmitting;
            registerBtn.disabled = shouldDisable;
            registerBtn.classList.toggle('disabled', shouldDisable);
            registerBtn.setAttribute('aria-disabled', shouldDisable ? 'true' : 'false');
        };

        const handleRegister = async () => {
            const name = nameField.value.trim();
            const email = emailField.value.trim();
            const password = passwordField.value;

            if (!name || !email || !password) {
                Components.Toast('Preencha todos os campos para continuar', 'warning');
                return;
            }

            if (isSubmitting) return;

            isSubmitting = true;
            updateRegisterButtonState();

            try {
                const success = await state.register(email, password, name);
                if (success) {
                    Components.Toast('Conta criada. Vamos começar!', 'success');
                } else {
                    Components.Toast(state.get('error') || 'Não foi possível criar a conta', 'error');
                }
            } finally {
                isSubmitting = false;
                updateRegisterButtonState();
            }
        };

        registerBtn = Components.Button('Criar minha conta', handleRegister, 'primary', 'large');
        registerBtn.type = 'submit';
        registerBtn.className = 'w-full btn btn-primary';
        registerBtn.style.justifyContent = 'center';
        registerBtn.style.padding = '14px 26px';

        nameField.addEventListener('input', updateRegisterButtonState);
        emailField.addEventListener('input', updateRegisterButtonState);
        passwordField.addEventListener('input', updateRegisterButtonState);
        updateRegisterButtonState();

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            handleRegister();
        });

        form.appendChild(registerBtn);

        const loginLink = createElement('p', { className: 'auth-switch' },
            'Já tem conta? ',
            createElement('button', {
                type: 'button',
                onClick: () => state.setState({ currentPage: 'login' })
            }, 'Fazer login')
        );

        form.appendChild(loginLink);
        card.appendChild(form);
        container.appendChild(card);

        return container;
    },

    // ========================================
    // DASHBOARD SCREEN
    // ========================================

    DashboardScreen: () => {
        const main = createElement('main', { className: 'flex-1' });
        const currentUser = state.get('user');
        const firstName = (currentUser?.name || 'estudante').split(' ')[0];

        main.appendChild(Components.Header('Dashboard'));

        // Dispara o carregamento de dados reais uma única vez para evitar o ciclo
        // de re-fetch a cada re-render da dashboard.
        if (!state.get('stats') && !_dashboardStatsLoaded && !_statsFetchInFlight) {
            _statsFetchInFlight = true;
            state.loadStats().finally(() => {
                _statsFetchInFlight = false;
                _dashboardStatsLoaded = true;
            });
        }
        if (!state.get('tasksLoaded') && !_dashboardTasksLoaded && !_tasksFetchInFlight) {
            _tasksFetchInFlight = true;
            state.loadTasks().finally(() => {
                _tasksFetchInFlight = false;
                _dashboardTasksLoaded = true;
            });
        }

        const stats = state.get('stats');
        const tasks = state.get('tasks') || [];
        const errorMsg = state.get('error');

        const hero = createElement('div', { className: 'hero-greeting flex flex-col md:flex-row md:items-center md:justify-between gap-6' },
            createElement('div', {},
                createElement('div', { className: 'eyebrow' }, new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })),
                createElement('h2', {}, `Bom estudo, ${firstName}`),
                createElement('p', {}, 'Você está a poucos minutos de manter sua sequência viva.')
            ),
            createElement('div', { className: 'stamp', style: { color: 'var(--warning)', borderColor: 'var(--warning)' } },
                createElement('span', { className: 'stamp-num' }, stats ? stats.streak_days : '—'),
                createElement('span', { className: 'stamp-label' }, 'dias seguidos')
            )
        );

        const children = [hero];

        if (errorMsg && !stats) {
            children.push(Components.Alert(`Não foi possível carregar seus dados: ${errorMsg}`, 'warning'));
        }

        const overdueCount = tasks.filter(t => getTaskUrgency(t) === 'overdue').length;
        const dueTodayCount = tasks.filter(t => getTaskUrgency(t) === 'today').length;
        if (overdueCount > 0 || dueTodayCount > 0) {
            const parts = [];
            if (overdueCount > 0) parts.push(`${overdueCount} atrasada${overdueCount > 1 ? 's' : ''}`);
            if (dueTodayCount > 0) parts.push(`${dueTodayCount} vencendo hoje`);
            children.push(Components.Alert(`Você tem tarefas pendentes: ${parts.join(' e ')}.`, overdueCount > 0 ? 'danger' : 'warning'));
        }

        children.push(
            createElement('div', { className: 'grid grid-cols-1 md:grid-cols-4 gap-5 mb-8' },
                Components.StatCard('Matérias', stats ? stats.subjects_count : '—', 'book', 'indigo'),
                Components.StatCard('Anotações', stats ? stats.notes_count : '—', 'sticky-note', 'blue'),
                Components.StatCard('Tarefas pendentes', stats ? stats.tasks_pending : '—', 'tasks', 'orange'),
                Components.StatCard('XP', stats ? stats.xp.toLocaleString('pt-BR') : '—', 'star', 'purple')
            )
        );

        const pendingTasks = tasks.filter(t => t.status !== 'completed').slice(0, 5);
        const tasksCard = Components.Card('Próximas tarefas',
            pendingTasks.length > 0
                ? createElement('div', { className: 'space-y-3' },
                    pendingTasks.map(task => {
                        const urgency = getTaskUrgency(task);
                        const dueDateColor = urgency === 'overdue' ? 'var(--danger)' : urgency === 'today' ? 'var(--warning-deep)' : 'var(--ink-faint)';
                        const urgencyLabel = urgency === 'overdue' ? 'atrasada' : urgency === 'today' ? 'vence hoje' : `vence em ${new Date(task.due_date).toLocaleDateString('pt-BR')}`;
                        return createElement('div', { className: 'flex items-center justify-between py-2', style: { borderBottom: '1px solid var(--surface-line)' } },
                            createElement('div', {},
                                createElement('p', { className: 'font-medium', style: { color: 'var(--ink)' } }, task.title),
                                task.due_date ? createElement('p', { className: 'text-xs mono-face', style: { color: dueDateColor } }, urgencyLabel) : null
                            ),
                            Components.Badge(TASK_PRIORITY_LABELS[task.priority] || 'Média', task.priority === 'high' ? 'danger' : 'warning')
                        );
                    })
                )
                : Components.EmptyState('tasks', 'Nenhuma tarefa por aqui', 'Crie sua primeira tarefa e comece a organizar a semana',
                    Components.Button('Criar tarefa', () => state.setState({ currentPage: 'tasks' }), 'primary', 'small')
                ),
            null
        );

        const weekly = (stats && stats.weekly_study_hours) || [];
        const weekCard = Components.Card('Progresso da semana',
            weekly.length > 0
                ? createElement('div', { className: 'space-y-4' },
                    weekly.map(d =>
                        createElement('div', {},
                            createElement('div', { className: 'flex justify-between text-sm mb-1' },
                                createElement('span', { style: { color: 'var(--ink-soft)' } }, d.day),
                                createElement('span', { className: 'mono-face font-semibold', style: { color: 'var(--ink)' } }, `${d.hours.toFixed(1)}h`)
                            ),
                            createElement('div', { className: 'w-full rounded-full h-2', style: { background: 'var(--surface-line)' } },
                                createElement('div', {
                                    className: 'rounded-full h-2 transition-all',
                                    style: { width: `${Math.min((d.hours / 5) * 100, 100)}%`, background: 'var(--accent)' }
                                })
                            )
                        )
                    )
                )
                : createElement('p', { className: 'text-sm', style: { color: 'var(--ink-soft)' } }, 'Comece a estudar para ver seu progresso aqui.'),
            null
        );

        children.push(
            createElement('div', { className: 'grid grid-cols-1 lg:grid-cols-3 gap-6' },
                createElement('div', { className: 'lg:col-span-2' }, tasksCard),
                weekCard
            )
        );

        main.appendChild(Components.Container(children));
        return main;
    },

    // ========================================
    // SUBJECTS SCREEN (Matérias)
    // ========================================

    SubjectsScreen: () => {
        const main = createElement('main', { className: 'flex-1' });
        main.appendChild(Components.Header('Matérias'));

        ensureSubjectsLoaded();
        const subjects = state.get('subjects') || [];

        const openCreateModal = () => {
            const nameInput = Components.Input('Nome da matéria', 'text', 'Ex: Matemática', '', null, 'book');
            let selectedColor = SUBJECT_COLORS[0];
            let selectedIcon = SUBJECT_ICONS[0];

            const colorSwatches = createElement('div', { className: 'flex gap-2 flex-wrap mb-4' });
            SUBJECT_COLORS.forEach(color => {
                const swatch = createElement('button', {
                    type: 'button',
                    className: 'w-8 h-8 rounded-full',
                    style: { background: color, border: `2px solid ${color === selectedColor ? 'var(--ink)' : 'transparent'}` },
                    onClick: (e) => {
                        selectedColor = color;
                        colorSwatches.querySelectorAll('button').forEach(b => { b.style.border = '2px solid transparent'; });
                        e.currentTarget.style.border = '2px solid var(--ink)';
                    }
                });
                colorSwatches.appendChild(swatch);
            });

            const iconSwatches = createElement('div', { className: 'flex gap-2 flex-wrap mb-4' });
            SUBJECT_ICONS.forEach(icon => {
                const btn = createElement('button', {
                    type: 'button',
                    className: 'w-9 h-9 rounded-lg flex items-center justify-center',
                    style: {
                        border: `1.5px solid ${icon === selectedIcon ? 'var(--accent)' : 'var(--surface-line)'}`,
                        color: 'var(--ink-soft)'
                    },
                    onClick: (e) => {
                        selectedIcon = icon;
                        iconSwatches.querySelectorAll('button').forEach(b => { b.style.border = '1.5px solid var(--surface-line)'; });
                        e.currentTarget.style.border = '1.5px solid var(--accent)';
                    }
                }, createElement('i', { className: `fas fa-${icon}` }));
                iconSwatches.appendChild(btn);
            });

            const body = createElement('div', {},
                nameInput,
                createElement('label', { className: 'label' }, 'Cor'),
                colorSwatches,
                createElement('label', { className: 'label' }, 'Ícone'),
                iconSwatches
            );

            const modal = Components.Modal('Nova matéria', body, [
                Components.Button('Cancelar', () => modal.remove(), 'secondary'),
                Components.Button('Salvar', async () => {
                    const name = nameInput.querySelector('input').value.trim();
                    if (!name) {
                        Components.Toast('Dê um nome para a matéria', 'warning');
                        return;
                    }
                    try {
                        await api.createSubject(name, selectedColor, selectedIcon);
                        Components.Toast('Matéria criada com sucesso', 'success');
                        modal.remove();
                        state.setState({ _subjectsLoaded: false });
                        state.invalidateStats();
                    } catch (err) {
                        Components.Toast(err.message, 'error');
                    }
                }, 'primary')
            ]);
            document.body.appendChild(modal);
        };

        const removeSubject = (subject) => {
            Components.ConfirmModal('Remover matéria', `Remover "${subject.name}"? Anotações e tarefas vinculadas ficam sem matéria, mas não são apagadas.`, async () => {
                try {
                    await api.deleteSubject(subject.id);
                    Components.Toast('Matéria removida', 'success');
                    state.setState({ _subjectsLoaded: false });
                    state.invalidateStats();
                } catch (err) {
                    Components.Toast(err.message, 'error');
                }
            });
        };

        const list = subjects.length > 0
            ? createElement('div', { className: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5' },
                subjects.map(subject =>
                    createElement('div', { className: 'card p-5 flex items-center justify-between' },
                        createElement('div', { className: 'flex items-center gap-3 min-w-0' },
                            createElement('div', {
                                className: 'w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0',
                                style: { background: `${subject.color}1A` }
                            }, createElement('i', { className: `fas fa-${subject.icon}`, style: { color: subject.color } })),
                            createElement('p', { className: 'font-medium truncate-line', style: { color: 'var(--ink)' } }, subject.name)
                        ),
                        createElement('button', {
                            className: 'p-2 rounded-lg hover:bg-[var(--surface-line)] flex-shrink-0',
                            onClick: () => removeSubject(subject),
                            title: 'Remover'
                        }, createElement('i', { className: 'fas fa-trash', style: { color: 'var(--ink-faint)' } }))
                    )
                )
            )
            : Components.EmptyState('layer-group', 'Nenhuma matéria ainda', 'Cadastre as matérias que você estuda para organizar anotações e tarefas',
                Components.Button('Criar matéria', openCreateModal, 'primary')
            );

        const content = Components.Container([
            createElement('div', { className: 'flex justify-between items-center mb-8' },
                createElement('h2', { className: 'text-2xl font-semibold display-face', style: { color: 'var(--ink)' } }, 'Suas matérias'),
                subjects.length > 0 ? Components.Button('+ Nova matéria', openCreateModal, 'primary') : null
            ),
            list
        ]);

        main.appendChild(content);
        return main;
    },

    // ========================================
    // NOTES SCREEN
    // ========================================

    NotesScreen: () => {
        const main = createElement('main', { className: 'flex-1' });
        main.appendChild(Components.Header('Anotações'));

        if (!state.get('notes') || (!_notesFetchInFlight && !state.get('_notesLoaded'))) {
            _notesFetchInFlight = true;
            state.loadNotes().finally(() => {
                _notesFetchInFlight = false;
                state.setState({ _notesLoaded: true });
            });
        }
        ensureSubjectsLoaded();

        const notes = state.get('notes') || [];

        // Modal compartilhado entre criar e editar — existingNote != null entra em modo edição.
        const openNoteModal = (existingNote = null) => {
            const isEdit = !!existingNote;
            const titleInput = Components.Input('Título', 'text', 'Ex: Revolução Francesa', existingNote?.title || '', null, 'heading');
            const contentInput = Components.Textarea('Conteúdo', 'Escreva sua anotação aqui...', existingNote?.content || '');
            const subjectSelect = buildSubjectSelect(state.get('subjects') || [], existingNote?.subject_id ? String(existingNote.subject_id) : '');
            const body = createElement('div', {}, titleInput, contentInput, subjectSelect);

            const modal = Components.Modal(isEdit ? 'Editar anotação' : 'Nova anotação', body, [
                Components.Button('Cancelar', () => modal.remove(), 'secondary'),
                Components.Button('Salvar', async () => {
                    const title = titleInput.querySelector('input').value.trim();
                    const contentField = contentInput.querySelector('textarea');
                    const content = contentField.value.trim();
                    const subjectIdRaw = subjectSelect.querySelector('select').value;
                    const subjectId = subjectIdRaw ? Number(subjectIdRaw) : null;
                    if (!title || !content) {
                        Components.Toast('Preencha título e conteúdo', 'warning');
                        return;
                    }
                    try {
                        if (isEdit) {
                            await api.updateNote(existingNote.id, { subject_id: subjectId, title, content });
                            Components.Toast('Anotação atualizada com sucesso', 'success');
                        } else {
                            await api.createNote(subjectId, title, content);
                            Components.Toast('Anotação criada com sucesso', 'success');
                        }
                        modal.remove();
                        state.setState({ _notesLoaded: false });
                    } catch (err) {
                        Components.Toast(err.message, 'error');
                    }
                }, 'primary')
            ]);
            document.body.appendChild(modal);
        };
        const openCreateModal = () => openNoteModal(null);

        const removeNote = (note) => {
            Components.ConfirmModal('Remover anotação', `Remover a anotação "${note.title}"? Essa ação não pode ser desfeita.`, async () => {
                try {
                    await api.deleteNote(note.id);
                    Components.Toast('Anotação removida', 'success');
                    state.setState({ _notesLoaded: false });
                } catch (err) {
                    Components.Toast(err.message, 'error');
                }
            });
        };

        const list = notes.length > 0
            ? createElement('div', { className: 'grid grid-cols-1 md:grid-cols-2 gap-5' },
                notes.map(note =>
                    Components.Card(note.title,
                        createElement('p', { className: 'text-sm truncate-lines', style: { color: 'var(--ink-soft)' } }, note.content),
                        'sticky-note',
                        null,
                        [
                            { icon: 'edit', title: 'Editar', onClick: () => openNoteModal(note) },
                            { icon: 'trash', title: 'Remover', danger: true, onClick: () => removeNote(note) }
                        ]
                    )
                )
            )
            : Components.EmptyState('sticky-note', 'Nenhuma anotação ainda', 'Crie sua primeira anotação para começar a organizar seus estudos',
                Components.Button('Criar anotação', openCreateModal, 'primary')
            );

        const content = Components.Container([
            createElement('div', { className: 'flex justify-between items-center mb-8' },
                createElement('h2', { className: 'text-2xl font-semibold display-face', style: { color: 'var(--ink)' } }, 'Suas anotações'),
                notes.length > 0 ? Components.Button('+ Nova anotação', openCreateModal, 'primary') : null
            ),
            list
        ]);

        main.appendChild(content);
        return main;
    },

    // ========================================
    // TASKS SCREEN
    // ========================================

    TasksScreen: () => {
        const main = createElement('main', { className: 'flex-1' });
        main.appendChild(Components.Header('Tarefas'));

        if (!_tasksScreenFetchInFlight && !state.get('tasksLoaded')) {
            _tasksScreenFetchInFlight = true;
            state.loadTasks().finally(() => {
                _tasksScreenFetchInFlight = false;
            });
        }
        ensureSubjectsLoaded();

        const tasks = state.get('tasks') || [];

        const openTaskModal = (existingTask = null) => {
            const isEdit = !!existingTask;
            const titleInput = Components.Input('Título da tarefa', 'text', 'Ex: Revisar Redação', existingTask?.title || '', null, 'pen');
            const dateInput = Components.Input('Data de entrega (opcional)', 'date', '', existingTask?.due_date ? existingTask.due_date.slice(0, 10) : '', null, 'calendar');
            const subjectSelect = buildSubjectSelect(state.get('subjects') || [], existingTask?.subject_id ? String(existingTask.subject_id) : '');
            const prioritySelect = Components.Select('Prioridade', TASK_PRIORITY_OPTIONS, existingTask?.priority || 'medium', null);
            const body = createElement('div', {}, titleInput, dateInput, subjectSelect, prioritySelect);

            const modal = Components.Modal(isEdit ? 'Editar tarefa' : 'Nova tarefa', body, [
                Components.Button('Cancelar', () => modal.remove(), 'secondary'),
                Components.Button('Salvar', async () => {
                    const title = titleInput.querySelector('input').value.trim();
                    const dueDate = dateInput.querySelector('input').value || null;
                    const subjectIdRaw = subjectSelect.querySelector('select').value;
                    const subjectId = subjectIdRaw ? Number(subjectIdRaw) : null;
                    const priority = prioritySelect.querySelector('select').value;
                    if (!title) {
                        Components.Toast('Dê um título para a tarefa', 'warning');
                        return;
                    }
                    try {
                        if (isEdit) {
                            await api.updateTask(existingTask.id, { title, subject_id: subjectId, due_date: dueDate, priority });
                            Components.Toast('Tarefa atualizada com sucesso', 'success');
                        } else {
                            await api.createTask(title, subjectId, dueDate, priority);
                            Components.Toast('Tarefa criada com sucesso', 'success');
                        }
                        modal.remove();
                        state.setState({ tasksLoaded: false });
                    } catch (err) {
                        Components.Toast(err.message, 'error');
                    }
                }, 'primary')
            ]);
            document.body.appendChild(modal);
        };
        const openCreateModal = () => openTaskModal(null);

        const toggleComplete = async (task) => {
            try {
                await api.completeTask(task.id);
                Components.Toast('Tarefa concluída. Bom trabalho!', 'success');
                state.setState({ tasksLoaded: false });
                // Completar uma tarefa ganha XP no backend — invalida as stats em cache
                // para que Dashboard/Estatísticas mostrem os números atualizados.
                _dashboardStatsLoaded = false;
                state.invalidateStats();
            } catch (err) {
                Components.Toast(err.message, 'error');
            }
        };

        const removeTask = (task) => {
            Components.ConfirmModal('Remover tarefa', `Remover a tarefa "${task.title}"? Essa ação não pode ser desfeita.`, async () => {
                try {
                    await api.deleteTask(task.id);
                    Components.Toast('Tarefa removida', 'success');
                    state.setState({ tasksLoaded: false });
                } catch (err) {
                    Components.Toast(err.message, 'error');
                }
            });
        };

        const overdueCount = tasks.filter(t => getTaskUrgency(t) === 'overdue').length;
        const urgencyAlert = overdueCount > 0
            ? Components.Alert(`Você tem ${overdueCount} tarefa${overdueCount > 1 ? 's' : ''} atrasada${overdueCount > 1 ? 's' : ''}.`, 'danger')
            : null;

        const list = tasks.length > 0
            ? createElement('div', { className: 'space-y-3' },
                tasks.map(task => {
                    const urgency = getTaskUrgency(task);
                    const dueDateColor = urgency === 'overdue' ? 'var(--danger)' : urgency === 'today' ? 'var(--warning-deep)' : 'var(--ink-faint)';
                    const urgencySuffix = urgency === 'overdue' ? ' · atrasada' : urgency === 'today' ? ' · vence hoje' : '';
                    return createElement('div', { className: 'card p-4 flex items-center justify-between' },
                        createElement('div', { className: 'flex items-center gap-3' },
                            createElement('button', {
                                className: 'w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0',
                                style: {
                                    borderColor: task.status === 'completed' ? 'var(--success)' : 'var(--surface-line)',
                                    background: task.status === 'completed' ? 'var(--success)' : 'transparent',
                                    color: '#fff'
                                },
                                onClick: () => task.status !== 'completed' && toggleComplete(task),
                                title: task.status === 'completed' ? 'Concluída' : 'Marcar como concluída'
                            }, task.status === 'completed' ? createElement('i', { className: 'fas fa-check text-xs' }) : null),
                            createElement('div', {},
                                createElement('p', {
                                    className: 'font-medium',
                                    style: {
                                        color: 'var(--ink)',
                                        textDecoration: task.status === 'completed' ? 'line-through' : 'none',
                                        opacity: task.status === 'completed' ? 0.5 : 1
                                    }
                                }, task.title),
                                task.due_date ? createElement('p', { className: 'text-xs mono-face', style: { color: dueDateColor } }, new Date(task.due_date).toLocaleDateString('pt-BR') + urgencySuffix) : null
                            )
                        ),
                        createElement('div', { className: 'flex items-center gap-2 flex-shrink-0' },
                            Components.Badge(TASK_PRIORITY_LABELS[task.priority] || 'Média', task.priority === 'high' ? 'danger' : 'warning'),
                            createElement('button', {
                                className: 'p-2 rounded-lg hover:bg-[var(--surface-line)]',
                                onClick: () => openTaskModal(task),
                                title: 'Editar'
                            }, createElement('i', { className: 'fas fa-edit', style: { color: 'var(--ink-faint)' } })),
                            createElement('button', {
                                className: 'p-2 rounded-lg hover:bg-[var(--surface-line)]',
                                onClick: () => removeTask(task),
                                title: 'Remover'
                            }, createElement('i', { className: 'fas fa-trash', style: { color: 'var(--ink-faint)' } }))
                        )
                    );
                })
            )
            : Components.EmptyState('tasks', 'Nenhuma tarefa ainda', 'Crie sua primeira tarefa e comece a organizar a semana',
                Components.Button('Criar tarefa', openCreateModal, 'primary')
            );

        const content = Components.Container([
            urgencyAlert,
            createElement('div', { className: 'flex justify-between items-center mb-8' },
                createElement('h2', { className: 'text-2xl font-semibold display-face', style: { color: 'var(--ink)' } }, 'Suas tarefas'),
                tasks.length > 0 ? Components.Button('+ Nova tarefa', openCreateModal, 'primary') : null
            ),
            list
        ]);

        main.appendChild(content);
        return main;
    },

    // ========================================
    // QUESTIONS SCREEN — Simulado ENEM (API pública enem.dev)
    // ========================================

    QuestionsScreen: () => {
        const main = createElement('main', { className: 'flex-1' });
        main.appendChild(Components.Header('Questões ENEM'));

        // Carrega a lista de provas/disciplinas disponíveis uma única vez
        if (!_enemState.exams && !_enemState.loadingExams && !_enemState.examsError) {
            _enemState.loadingExams = true;
            api.getEnemExams()
                .then(exams => { _enemState.exams = exams; })
                .catch(err => { _enemState.examsError = err.message; })
                .finally(() => {
                    _enemState.loadingExams = false;
                    state.setState({ _enemTick: ++_enemTickCounter });
                });
        }

        // Carrega o histórico de simulados já finalizados uma única vez (ver
        // historyCard na tela de configuração) — recarrega depois de um novo
        // simulado ser finalizado (restart() zera historyLoaded).
        if (!_enemHistoryFetchInFlight && !_enemState.historyLoaded) {
            _enemHistoryFetchInFlight = true;
            api.getEnemSimulados(10)
                .then(list => { _enemState.history = list; })
                .catch(err => { _enemState.history = []; warn('Não foi possível carregar o histórico de simulados:', err.message); })
                .finally(() => {
                    _enemHistoryFetchInFlight = false;
                    _enemState.historyLoaded = true;
                    state.setState({ _enemTick: ++_enemTickCounter });
                });
        }

        const rerender = () => {
            persistEnemState();
            state.setState({ _enemTick: ++_enemTickCounter });
        };

        const startQuiz = async () => {
            if (!_enemState.year || !_enemState.discipline) {
                Components.Toast('Escolha o ano e a área antes de começar', 'warning');
                return;
            }
            _enemState.loadingQuestions = true;
            _enemState.questionsError = null;
            _enemState.loadingProgress = null;
            rerender();
            try {
                const questionsPayload = await api.getAllEnemQuestions(_enemState.year, {
                    onProgress: (loaded, total) => {
                        _enemState.loadingProgress = { loaded, total };
                        rerender();
                    }
                });
                const filtered = questionsPayload.filter(q => q.discipline === _enemState.discipline);
                if (filtered.length === 0) {
                    _enemState.questionsError = 'Não encontramos questões dessa área para o ano escolhido. Tente outro ano.';
                } else {
                    const qty = _enemState.quantity === 'todas' ? filtered.length : Math.min(Number(_enemState.quantity), filtered.length);
                    _enemState.questions = filtered.slice(0, qty);
                    _enemState.currentIndex = 0;
                    _enemState.answers = {};
                    _enemState.started = true;
                    _enemState.totalTimeSpent = 0;
                    _enemState.simuladoRecorded = false;
                    _enemState.reviewMode = false;
                    _enemState.reviewIndices = [];
                    _enemState.questionStartedAt = Date.now();
                }
            } catch (err) {
                _enemState.questionsError = err.message;
            } finally {
                _enemState.loadingQuestions = false;
                _enemState.loadingProgress = null;
                rerender();
            }
        };

        const selectAnswer = (letter) => {
            const idx = _enemState.currentIndex;
            if (_enemState.answers[idx] !== undefined) return; // já respondida
            _enemState.answers[idx] = letter;
            rerender();

            // Registra a resposta no backend para alimentar as estatísticas reais
            // de desempenho no ENEM. Isso é só telemetria: se falhar (ex. backend
            // fora do ar), o simulado continua funcionando normalmente.
            const q = _enemState.questions[idx];
            const startedAt = _enemState.questionStartedAt || Date.now();
            const timeSpent = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
            _enemState.totalTimeSpent = (_enemState.totalTimeSpent || 0) + timeSpent;
            api.recordEnemAttempt({
                year: Number(_enemState.year),
                discipline: _enemState.discipline,
                question_index: q.index ?? idx,
                selected_letter: letter,
                correct_letter: q.correctAlternative,
                is_correct: letter === q.correctAlternative,
                time_spent_seconds: timeSpent
            }).catch(err => warn('Não foi possível registrar a resposta do ENEM nas estatísticas:', err.message));
        };

        // "Corta" (risca) uma alternativa por eliminação, sem selecioná-la como resposta.
        // Sempre deixa pelo menos uma alternativa disponível: cortar as 4 tornaria
        // impossível escolher uma resposta.
        const toggleCrossOut = (letter) => {
            const idx = _enemState.currentIndex;
            if (!_enemState.crossedOut[idx]) _enemState.crossedOut[idx] = {};
            const alreadyCrossed = !!_enemState.crossedOut[idx][letter];
            if (alreadyCrossed) {
                delete _enemState.crossedOut[idx][letter];
            } else {
                const totalAlternatives = _enemState.questions[idx].alternatives.length;
                const crossedCount = Object.keys(_enemState.crossedOut[idx]).length;
                if (crossedCount >= totalAlternatives - 1) {
                    Components.Toast('Deixe pelo menos uma alternativa disponível para responder', 'warning');
                    return;
                }
                _enemState.crossedOut[idx][letter] = true;
            }
            rerender();
        };

        // Durante a revisão de erros, "próxima"/"anterior" andam só entre as
        // questões erradas/puladas (reviewIndices), não entre todas as questões —
        // isso é o que faz swipe, atalho de teclado e botões concordarem sozinhos
        // sem cada um precisar saber sobre o modo de revisão.
        const goToReviewOffset = (delta) => {
            const pos = _enemState.reviewIndices.indexOf(_enemState.currentIndex);
            const nextPos = (pos === -1 ? 0 : pos) + delta;
            if (nextPos >= 0 && nextPos < _enemState.reviewIndices.length) {
                _enemState.currentIndex = _enemState.reviewIndices[nextPos];
                _enemState.questionStartedAt = Date.now();
                rerender();
            }
        };

        const goToQuestion = (delta) => {
            if (_enemState.reviewMode) {
                goToReviewOffset(delta);
                return;
            }
            const next = _enemState.currentIndex + delta;
            if (next >= 0 && next < _enemState.questions.length) {
                _enemState.currentIndex = next;
                _enemState.questionStartedAt = Date.now();
                rerender();
            }
        };

        // Pula para a próxima questão sem exigir resposta
        const skipQuestion = () => goToQuestion(1);

        // Vai direto para uma questão específica (usado pelo navegador de questões)
        const jumpToQuestion = (i) => {
            if (i >= 0 && i < _enemState.questions.length) {
                _enemState.currentIndex = i;
                _enemState.finished = false;
                _enemState.questionStartedAt = Date.now();
                rerender();
            }
        };

        // Entra no modo de revisão: pula direto para a primeira questão errada ou
        // não respondida (contam como erro), e mantém a navegação restrita a elas.
        const startReview = () => {
            const wrongIndices = _enemState.questions.reduce((acc, qq, i) => {
                const chosen = _enemState.answers[i];
                if (chosen === undefined || chosen !== qq.correctAlternative) acc.push(i);
                return acc;
            }, []);
            if (wrongIndices.length === 0) {
                Components.Toast('Você acertou todas as questões! Nada para revisar.', 'success');
                return;
            }
            _enemState.reviewMode = true;
            _enemState.reviewIndices = wrongIndices;
            _enemState.finished = false;
            _enemState.currentIndex = wrongIndices[0];
            _enemState.questionStartedAt = Date.now();
            rerender();
        };

        // Sai da revisão e volta para a tela de resultado
        const backToResults = () => {
            _enemState.reviewMode = false;
            _enemState.finished = true;
            rerender();
        };

        // Encerra o simulado a qualquer momento, mesmo com questões não respondidas
        const finishQuiz = () => {
            _enemState.finished = true;
            // Só registra o simulado no histórico na primeira vez que é encerrado —
            // reabrir o resultado (ex.: pelo botão "Encerrar" de novo) não deve
            // duplicar a entrada no histórico.
            if (!_enemState.simuladoRecorded) {
                _enemState.simuladoRecorded = true;
                const qs = _enemState.questions;
                const correctCount = qs.reduce((acc, qq, i) => acc + (_enemState.answers[i] === qq.correctAlternative ? 1 : 0), 0);
                api.recordEnemSimulado({
                    year: Number(_enemState.year),
                    discipline: _enemState.discipline,
                    total_questions: qs.length,
                    correct_count: correctCount,
                    time_spent_seconds: Math.round(_enemState.totalTimeSpent || 0)
                }).catch(err => warn('Não foi possível salvar este simulado no histórico:', err.message));
            }
            rerender();
        };

        const restart = () => {
            _enemState.started = false;
            _enemState.questions = [];
            _enemState.answers = {};
            _enemState.crossedOut = {};
            _enemState.currentIndex = 0;
            _enemState.finished = false;
            _enemState.totalTimeSpent = 0;
            _enemState.simuladoRecorded = false;
            _enemState.reviewMode = false;
            _enemState.reviewIndices = [];
            _enemState.historyLoaded = false;
            rerender();
        };

        // --------- Tela de configuração (antes de começar) ---------
        if (!_enemState.started) {
            let setupBody;

            if (_enemState.loadingExams) {
                setupBody = Components.Loading();
            } else {
                const examsList = _enemState.exams;
                const years = examsList ? examsList.map(e => e.year).sort((a, b) => b - a) : ENEM_FALLBACK_YEARS;
                if (!_enemState.year) _enemState.year = years[0];

                const currentExam = examsList ? examsList.find(e => e.year === Number(_enemState.year)) : null;
                const disciplines = currentExam ? currentExam.disciplines : ENEM_FALLBACK_DISCIPLINES;
                if (!_enemState.discipline) _enemState.discipline = disciplines[0].value;

                const yearSelect = Components.Select('Ano da prova', years.map(y => ({ value: y, label: `ENEM ${y}` })), _enemState.year, (e) => {
                    _enemState.year = e.target.value;
                    _enemState.discipline = null;
                    rerender();
                });

                // Ícone por área — cada disciplina vira um cartão clicável em vez de
                // uma opção escondida dentro de um <select>, pra ficar visível de
                // cara quais áreas existem e qual está selecionada.
                const DISCIPLINE_ICONS = {
                    'linguagens': 'language',
                    'ciencias-humanas': 'landmark',
                    'ciencias-natureza': 'flask',
                    'matematica': 'calculator'
                };

                const disciplineCards = createElement('div', { className: 'mb-4' },
                    createElement('label', { className: 'label' }, 'Área de conhecimento'),
                    createElement('div', { className: 'grid grid-cols-2 gap-3' },
                        disciplines.map(d => {
                            const isSelected = d.value === _enemState.discipline;
                            return createElement('button', {
                                type: 'button',
                                className: 'card p-4 text-left flex flex-col items-start gap-2',
                                style: { border: `2px solid ${isSelected ? 'var(--accent)' : 'transparent'}`, cursor: 'pointer' },
                                onClick: () => { _enemState.discipline = d.value; rerender(); }
                            },
                                createElement('div', {
                                    className: 'w-10 h-10 rounded-lg flex items-center justify-center',
                                    style: { background: isSelected ? 'var(--accent)' : 'rgba(0,113,227,0.1)' }
                                }, createElement('i', {
                                    className: `fas fa-${DISCIPLINE_ICONS[d.value] || 'book'}`,
                                    style: { color: isSelected ? '#fff' : 'var(--accent)' }
                                })),
                                createElement('span', { className: 'text-sm font-medium', style: { color: 'var(--ink)' } }, d.label)
                            );
                        })
                    )
                );

                const qtySelect = Components.Select('Quantidade de questões', [
                    { value: '5', label: '5 questões' },
                    { value: '10', label: '10 questões' },
                    { value: '20', label: '20 questões' },
                    { value: 'todas', label: 'Prova completa da área' }
                ], String(_enemState.quantity), (e) => { _enemState.quantity = e.target.value; });

                const loadingLabel = _enemState.loadingProgress
                    ? `Carregando... (${_enemState.loadingProgress.loaded}/${_enemState.loadingProgress.total})`
                    : 'Carregando questões...';
                const startBtn = Components.Button(
                    _enemState.loadingQuestions ? loadingLabel : 'Começar simulado',
                    startQuiz, 'primary', 'large', 'play'
                );
                startBtn.style.width = '100%';
                startBtn.style.justifyContent = 'center';
                if (_enemState.loadingQuestions) startBtn.setAttribute('disabled', '');

                setupBody = createElement('div', {},
                    _enemState.examsError ? Components.Alert(`Não conseguimos carregar a lista completa de provas (${_enemState.examsError}). Usando uma lista padrão de anos e áreas.`, 'warning') : null,
                    yearSelect, disciplineCards, qtySelect,
                    _enemState.questionsError ? Components.Alert(_enemState.questionsError, 'danger') : null,
                    startBtn
                );
            }

            // Histórico dos últimos simulados finalizados — mostra a evolução do
            // usuário ao longo do tempo (diferente das estatísticas por disciplina,
            // que são só um agregado sem noção de "simulados" individuais).
            const DISCIPLINE_LABELS = {
                'linguagens': 'Linguagens',
                'ciencias-humanas': 'Ciências Humanas',
                'ciencias-natureza': 'Ciências da Natureza',
                'matematica': 'Matemática'
            };
            const history = _enemState.history || [];
            const historyCard = history.length > 0
                ? Components.Card('Histórico de simulados',
                    createElement('div', {},
                        history.map((h, i) => {
                            const accuracy = h.total_questions > 0 ? Math.round((h.correct_count / h.total_questions) * 100) : 0;
                            return createElement('div', {
                                className: 'flex items-center justify-between gap-3 py-2',
                                style: { borderBottom: i < history.length - 1 ? '1px solid var(--surface-line)' : 'none' }
                            },
                                createElement('div', { className: 'min-w-0' },
                                    createElement('p', { className: 'text-sm font-medium truncate-line', style: { color: 'var(--ink)' } }, `ENEM ${h.year} · ${DISCIPLINE_LABELS[h.discipline] || h.discipline}`),
                                    createElement('p', { className: 'text-xs', style: { color: 'var(--ink-faint)' } }, `${new Date(h.created_at).toLocaleDateString('pt-BR')} · ${formatDuration(h.time_spent_seconds)}`)
                                ),
                                createElement('div', { className: 'text-right flex-shrink-0' },
                                    createElement('p', { className: 'text-sm font-semibold mono-face', style: { color: 'var(--accent)' } }, `${h.correct_count}/${h.total_questions}`),
                                    createElement('p', { className: 'text-xs', style: { color: 'var(--ink-faint)' } }, `${accuracy}%`)
                                )
                            );
                        })
                    ),
                    'history'
                  )
                : null;

            const content = Components.Container([
                createElement('div', { className: 'mb-8' },
                    createElement('h2', { className: 'text-2xl font-semibold display-face mb-2', style: { color: 'var(--ink)' } }, 'Pratique com questões reais do ENEM'),
                    createElement('p', { className: 'text-sm', style: { color: 'var(--ink-soft)' } }, 'Dados de provas de anos anteriores, via API pública enem.dev — gratuita e sem necessidade de login.')
                ),
                createElement('div', { className: 'max-w-lg mx-auto lg:mx-0' }, Components.Card('Configurar simulado', setupBody, 'graduation-cap')),
                historyCard ? createElement('div', { className: 'max-w-lg mx-auto lg:mx-0 mt-6' }, historyCard) : null
            ]);

            main.appendChild(content);
            return main;
        }

        // --------- Tela do quiz em andamento ---------
        const questions = _enemState.questions;
        const idx = _enemState.currentIndex;
        const q = questions[idx];
        const answeredLetter = _enemState.answers[idx];
        const totalAnswered = Object.keys(_enemState.answers).length;
        const totalCorrect = questions.reduce((acc, qq, i) => {
            const chosen = _enemState.answers[i];
            return acc + (chosen && chosen === qq.correctAlternative ? 1 : 0);
        }, 0);
        const isLast = idx === questions.length - 1;
        const reviewPos = _enemState.reviewMode ? _enemState.reviewIndices.indexOf(idx) : -1;
        const reviewIsLast = _enemState.reviewMode && reviewPos === _enemState.reviewIndices.length - 1;

        const header = createElement('div', { className: 'flex items-center justify-between gap-3 mb-3' },
            createElement('span', { className: 'text-sm mono-face truncate-line', style: { color: 'var(--ink-soft)' } },
                _enemState.reviewMode
                    ? `Revisão · ${reviewPos + 1} de ${_enemState.reviewIndices.length} questões erradas/puladas`
                    : `Questão ${idx + 1} de ${questions.length} · ${totalAnswered} respondidas`
            ),
            createElement('div', { className: 'flex items-center gap-3 flex-shrink-0' },
                createElement('span', { className: 'text-sm mono-face font-semibold', style: { color: 'var(--success-deep)' } }, `${totalCorrect} acertos`),
                (!_enemState.finished && !_enemState.reviewMode)
                    ? createElement('button', {
                        className: 'text-xs font-semibold',
                        style: { color: 'var(--ink-faint)', textDecoration: 'underline', textUnderlineOffset: '2px' },
                        onClick: finishQuiz,
                        title: 'Encerrar o simulado agora e ver o resultado'
                    }, 'Encerrar')
                    : null
            )
        );

        const progressBar = createElement('div', { className: 'enem-progress-bar mb-4' },
            createElement('div', { className: 'enem-progress-fill', style: { width: `${((idx + 1) / questions.length) * 100}%` } })
        );

        // Navegador de questões: clique em qualquer número para pular direto pra ela
        const navigatorGrid = createElement('div', { className: 'enem-nav-grid mb-6' },
            questions.map((qq, i) => {
                const letter = _enemState.answers[i];
                let dotCls = 'enem-nav-dot';
                if (i === idx && !_enemState.finished) dotCls += ' current';
                if (letter !== undefined) dotCls += letter === qq.correctAlternative ? ' correct' : ' incorrect';
                return createElement('button', {
                    className: dotCls,
                    title: `Ir para a questão ${i + 1}`,
                    onClick: () => jumpToQuestion(i)
                }, String(i + 1));
            })
        );

        const imagesBlock = (q.files && q.files.length > 0)
            ? createElement('div', {}, q.files.map(f => createElement('img', { src: f, className: 'enem-question-img', alt: 'Imagem da questão' })))
            : null;

        // Texto-base (enunciado/contexto de leitura) — separado visualmente do comando da questão
        const contextBlock = (q.context || imagesBlock)
            ? createElement('div', { className: 'enem-context-box mb-4' },
                createElement('span', { className: 'enem-context-label' }, 'Texto-base'),
                q.context ? createElement('div', { className: 'text-sm', style: { color: 'var(--ink)' } }, renderTextWithImages(q.context)) : null,
                imagesBlock
              )
            : null;

        // Comando da questão — o que de fato está sendo perguntado
        const introBlock = q.alternativesIntroduction ? createElement('div', { className: 'enem-prompt text-sm mb-4' }, renderTextWithImages(q.alternativesIntroduction)) : null;

        const LONG_PRESS_MS = 500;
        const LONG_PRESS_MOVE_TOLERANCE = 10;

        const optionsBlock = createElement('div', {},
            q.alternatives.map(alt => {
                const isAnswered = answeredLetter !== undefined;
                // Revisão é só leitura — mesmo numa questão PULADA (sem answeredLetter),
                // não deixa responder de novo (o simulado já foi encerrado e registrado
                // no histórico com o placar daquele momento) e sempre mostra o gabarito.
                const isLocked = isAnswered || _enemState.reviewMode;
                const isChosen = answeredLetter === alt.letter;
                const isCorrectAlt = alt.letter === q.correctAlternative;
                const isCrossedOut = !!(_enemState.crossedOut[idx] && _enemState.crossedOut[idx][alt.letter]);
                let cls = 'enem-option';
                if (isLocked) {
                    cls += ' answered disabled-choice';
                    if (isCorrectAlt) cls += ' correct';
                    else if (isChosen) cls += ' incorrect';
                }
                if (isCrossedOut && !isLocked) cls += ' crossed-out';

                // Gesto de "segurar para cortar": pressionar e manter o dedo/mouse
                // parado sobre a alternativa por LONG_PRESS_MS corta ela (em vez do
                // antigo botão de tesoura, que exigia mirar num alvo pequeno à parte).
                // Clique curto (sem segurar) continua selecionando a resposta normalmente.
                let pressTimer = null;
                let pressStartX = 0;
                let pressStartY = 0;
                let longPressFired = false;

                const clearPressTimer = (el) => {
                    if (pressTimer) {
                        clearTimeout(pressTimer);
                        pressTimer = null;
                    }
                    if (el) el.classList.remove('pressing');
                };

                const selectArea = createElement('div', {
                    className: 'enem-option-select',
                    role: 'button',
                    tabIndex: isLocked ? -1 : 0,
                    title: isLocked ? undefined : 'Toque e segure (ou clique com o botão direito) para cortar esta alternativa',
                    onClick: () => {
                        if (longPressFired) {
                            // Esse clique é só o "soltar" do gesto de segurar — o corte já
                            // aconteceu quando o tempo de espera terminou, então isso não
                            // deve contar como uma escolha de resposta.
                            longPressFired = false;
                            return;
                        }
                        if (!isLocked) selectAnswer(alt.letter);
                    },
                    onKeyDown: (e) => {
                        if (!isLocked && (e.key === 'Enter' || e.key === ' ')) {
                            e.preventDefault();
                            selectAnswer(alt.letter);
                        }
                    },
                    onContextMenu: (e) => {
                        // Atalho equivalente ao "segurar", acessível via teclado
                        // (tecla Menu / Shift+F10) para quem não usa mouse/toque.
                        e.preventDefault();
                        if (!isLocked) toggleCrossOut(alt.letter);
                    },
                    onPointerDown: (e) => {
                        if (isLocked || (e.button !== undefined && e.button !== 0)) return;
                        pressStartX = e.clientX;
                        pressStartY = e.clientY;
                        longPressFired = false;
                        const el = e.currentTarget;
                        clearPressTimer(el);
                        el.classList.add('pressing');
                        pressTimer = setTimeout(() => {
                            pressTimer = null;
                            longPressFired = true;
                            el.classList.remove('pressing');
                            toggleCrossOut(alt.letter);
                        }, LONG_PRESS_MS);
                    },
                    onPointerMove: (e) => {
                        if (!pressTimer) return;
                        const dx = Math.abs(e.clientX - pressStartX);
                        const dy = Math.abs(e.clientY - pressStartY);
                        if (dx > LONG_PRESS_MOVE_TOLERANCE || dy > LONG_PRESS_MOVE_TOLERANCE) {
                            clearPressTimer(e.currentTarget);
                        }
                    },
                    onPointerUp: (e) => clearPressTimer(e.currentTarget),
                    onPointerCancel: (e) => clearPressTimer(e.currentTarget),
                    onPointerLeave: (e) => clearPressTimer(e.currentTarget)
                },
                    createElement('span', { className: 'enem-letter' }, alt.letter),
                    createElement('span', { className: isCrossedOut ? 'flex-1 enem-crossed-text' : 'flex-1' },
                        alt.text ? renderTextWithImages(alt.text) : null,
                        alt.file ? createElement('img', { src: alt.file, className: 'enem-question-img', alt: `Alternativa ${alt.letter}` }) : null
                    )
                );

                return createElement('div', { className: cls }, selectArea);
            })
        );

        const feedbackBlock = (answeredLetter !== undefined)
            ? Components.Alert(
                answeredLetter === q.correctAlternative ? 'Boa! Resposta correta.' : `Resposta incorreta. A alternativa certa é a ${q.correctAlternative}.`,
                answeredLetter === q.correctAlternative ? 'success' : 'danger',
                false
              )
            : (_enemState.reviewMode
                ? Components.Alert(`Você não respondeu esta questão. A alternativa certa é a ${q.correctAlternative}.`, 'warning', false)
                : null);

        const nextButton = isLast
            ? Components.Button('Finalizar simulado', finishQuiz, 'primary', 'medium', 'flag-checkered', false)
            : (answeredLetter === undefined
                ? Components.Button('Pular questão', skipQuestion, 'secondary', 'medium', 'forward', false)
                : Components.Button('Próxima', () => goToQuestion(1), 'primary', 'medium', 'arrow-right', false));

        const navButtons = createElement('div', { className: 'flex flex-col sm:flex-row gap-3 mt-6' },
            Components.Button('Anterior', () => goToQuestion(-1), 'secondary', 'medium', null, idx === 0),
            nextButton
        );

        // Durante a revisão, os botões de navegação normais (Anterior/Próxima/
        // Pular/Finalizar) não fazem sentido — a navegação é só entre as questões
        // erradas/puladas, terminando sempre com "Voltar ao resultado".
        const reviewNavButtons = createElement('div', { className: 'flex flex-col sm:flex-row gap-3 mt-6' },
            Components.Button('◂ Anterior errada', () => goToQuestion(-1), 'secondary', 'medium', null, reviewPos <= 0),
            reviewIsLast
                ? Components.Button('Voltar ao resultado', backToResults, 'primary', 'medium', 'flag-checkered', false)
                : Components.Button('Próxima errada ▸', () => goToQuestion(1), 'primary', 'medium', 'arrow-right', false)
        );

        const finishLink = (!_enemState.finished && !_enemState.reviewMode)
            ? createElement('div', { className: 'text-center mt-3' },
                Components.Button('Encerrar simulado e ver resultado', finishQuiz, 'outline', 'small', 'flag-checkered', false)
              )
            : null;

        const quizCard = Components.Card(q.title || `Questão ${q.index}`,
            createElement('div', {}, contextBlock, introBlock, optionsBlock, feedbackBlock),
            null
        );

        // --------- Arrastar (swipe) para navegar, tipo QConcurso ---------
        // Estado do arraste vive só localmente durante o gesto — não precisa de rerender
        // enquanto arrasta (o card segue o dedo/mouse via transform direto no DOM, e só
        // no fim decidimos se navega — pelas funções já existentes goToQuestion — ou volta
        // pro centro).
        const DRAG_COMMIT_PX = 110;
        let dragState = null;

        const attemptSwipeNavigate = (direction) => {
            // direction: -1 = anterior, 1 = próxima
            if (_enemState.reviewMode) {
                if (direction < 0 && reviewPos > 0) { goToQuestion(-1); return true; }
                if (direction > 0 && reviewPos < _enemState.reviewIndices.length - 1) { goToQuestion(1); return true; }
                return false;
            }
            if (direction < 0 && idx > 0) { goToQuestion(-1); return true; }
            if (direction > 0 && idx < questions.length - 1) { goToQuestion(1); return true; }
            return false;
        };

        const resetCardStyle = (el) => {
            el.style.transition = 'transform 0.25s ease, opacity 0.25s ease';
            el.style.transform = '';
            el.style.opacity = '';
            el.style.userSelect = '';
        };

        const onCardPointerDown = (e) => {
            if (e.button !== undefined && e.button !== 0) return; // só botão esquerdo do mouse
            dragState = { startX: e.clientX, startY: e.clientY, dragging: false, pointerId: e.pointerId, el: e.currentTarget };
        };

        const onCardPointerMove = (e) => {
            if (!dragState || e.pointerId !== dragState.pointerId) return;
            const dx = e.clientX - dragState.startX;
            const dy = e.clientY - dragState.startY;

            if (!dragState.dragging) {
                if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy)) return; // ainda não é claramente horizontal
                dragState.dragging = true;
                dragState.el.setPointerCapture(dragState.pointerId);
                dragState.el.style.transition = 'none';
                dragState.el.style.userSelect = 'none';
                // Evita que o "click" nativo sintetizado ao soltar o mouse depois de um
                // arraste acabe selecionando a alternativa que ficou por baixo do cursor
                // (na questão antiga ou já na nova, depois da troca).
                const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
                document.addEventListener('click', swallow, true);
                setTimeout(() => document.removeEventListener('click', swallow, true), 300);
            }

            // Resistência (rubber-band) quando não há pra onde ir naquela direção
            let effectiveDx = dx;
            if ((dx > 0 && idx === 0) || (dx < 0 && idx === questions.length - 1)) {
                effectiveDx = dx * 0.25;
            }

            dragState.el.style.transform = `translateX(${effectiveDx}px) rotate(${effectiveDx / 24}deg)`;
            dragState.el.style.opacity = String(Math.max(1 - Math.abs(effectiveDx) / 500, 0.5));
            e.preventDefault();
        };

        const onCardPointerUp = (e) => {
            if (!dragState || e.pointerId !== dragState.pointerId) return;
            const wasDragging = dragState.dragging;
            const dx = e.clientX - dragState.startX;
            const el = dragState.el;
            dragState = null;
            if (!wasDragging) return;

            if (Math.abs(dx) > DRAG_COMMIT_PX) {
                const direction = dx < 0 ? 1 : -1;
                if (attemptSwipeNavigate(direction)) return; // tela vai re-renderizar com o novo card já centralizado
            }
            resetCardStyle(el);
        };

        const onCardPointerCancel = () => {
            if (!dragState) return;
            const el = dragState.el;
            dragState = null;
            resetCardStyle(el);
        };

        const draggableCard = createElement('div', {
            className: 'enem-card-drag-wrapper',
            onPointerDown: onCardPointerDown,
            onPointerMove: onCardPointerMove,
            onPointerUp: onCardPointerUp,
            onPointerCancel: onCardPointerCancel
        }, quizCard);

        const swipeHint = createElement('p', { className: 'enem-swipe-hint' }, '◂ arraste o cartão para o lado para navegar ▸');
        const crossOutHint = _enemState.reviewMode ? null : createElement('p', { className: 'enem-swipe-hint' }, 'Toque e segure uma alternativa para cortá-la');

        const summaryCard = _enemState.finished
            ? Components.Card('Resultado do simulado',
                createElement('div', { className: 'text-center py-4' },
                    createElement('p', { className: 'text-4xl font-bold mono-face mb-2', style: { color: 'var(--accent)' } }, `${totalCorrect}/${questions.length}`),
                    createElement('p', { className: 'text-sm mb-2', style: { color: 'var(--ink-soft)' } }, 'questões corretas neste simulado'),
                    createElement('p', { className: 'text-xs mb-2', style: { color: 'var(--ink-faint)' } }, `Tempo total respondendo: ${formatDuration(_enemState.totalTimeSpent)}`),
                    totalAnswered < questions.length
                        ? createElement('p', { className: 'text-xs mb-6', style: { color: 'var(--ink-soft)' } }, `${questions.length - totalAnswered} questão(ões) não respondida(s) — contam como erro.`)
                        : createElement('div', { className: 'mb-6' }),
                    Components.Button('Revisar respostas erradas', startReview, 'secondary', 'medium', 'search', false),
                    createElement('span', { style: { display: 'inline-block', width: '12px' } }),
                    Components.Button('Fazer outro simulado', restart, 'primary')
                ),
                null
              )
            : null;

        // Atalhos de teclado: 1-5 ou A-E respondem a alternativa correspondente,
        // setas esquerda/direita navegam entre questões. O listener é sempre
        // removido e recriado a cada render — nunca se acumula, e referencia
        // sempre os dados/funções da questão atual (nunca fica "preso" numa
        // questão antiga depois de navegar).
        if (_enemKeydownHandler) {
            document.removeEventListener('keydown', _enemKeydownHandler);
        }
        _enemKeydownHandler = (e) => {
            const activeTag = document.activeElement?.tagName;
            if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT') return;

            const letterFromKey = { '1': 'A', '2': 'B', '3': 'C', '4': 'D', '5': 'E', 'a': 'A', 'b': 'B', 'c': 'C', 'd': 'D', 'e': 'E' }[e.key.toLowerCase()];
            if (letterFromKey && answeredLetter === undefined && !_enemState.reviewMode && q.alternatives.some(a => a.letter === letterFromKey)) {
                e.preventDefault();
                selectAnswer(letterFromKey);
                return;
            }
            if (e.key === 'ArrowRight') {
                e.preventDefault();
                goToQuestion(1);
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                goToQuestion(-1);
            }
        };
        document.addEventListener('keydown', _enemKeydownHandler);

        const content = Components.Container([
            createElement('div', { className: 'max-w-2xl mx-auto' },
                header, progressBar, navigatorGrid,
                summaryCard ? summaryCard : createElement('div', {}, swipeHint, crossOutHint, draggableCard, (_enemState.reviewMode ? reviewNavButtons : navButtons), finishLink)
            )
        ]);

        main.appendChild(content);
        return main;
    },

    /** Remove o listener de atalhos de teclado do simulado ENEM (ver
     *  QuestionsScreen). Precisa ser chamado ao navegar pra outra tela — sem
     *  isso o listener em `document` nunca seria removido, ficando preso pra
     *  sempre referenciando a última questão vista antes de sair da tela. */
    teardownEnemKeydown: () => {
        if (_enemKeydownHandler) {
            document.removeEventListener('keydown', _enemKeydownHandler);
            _enemKeydownHandler = null;
        }
    },

    // ========================================
    // ESSAYS SCREEN (Redações)
    // ========================================

    EssaysScreen: () => {
        const main = createElement('main', { className: 'flex-1' });
        main.appendChild(Components.Header('Redações'));

        if (!_essaysFetchInFlight && !state.get('_essaysLoaded')) {
            _essaysFetchInFlight = true;
            state.loadEssays().finally(() => {
                _essaysFetchInFlight = false;
                state.setState({ _essaysLoaded: true });
            });
        }

        const essays = state.get('essays') || [];

        const openEssayModal = (existingEssay = null) => {
            const isEdit = !!existingEssay;
            const titleInput = Components.Input('Título da redação', 'text', 'Ex: A importância da leitura', existingEssay?.title || '', null, 'heading');
            const contentInput = Components.Textarea('Texto da redação', 'Escreva ou cole sua redação aqui...', existingEssay?.content || '');
            const body = createElement('div', {},
                titleInput, contentInput,
                isEdit && existingEssay.score !== null && existingEssay.score !== undefined
                    ? Components.Alert('Editar o texto apaga a correção atual — você poderá corrigir de novo depois de salvar.', 'warning', false)
                    : null
            );

            const modal = Components.Modal(isEdit ? 'Editar redação' : 'Nova redação', body, [
                Components.Button('Cancelar', () => modal.remove(), 'secondary'),
                Components.Button('Salvar', async () => {
                    const title = titleInput.querySelector('input').value.trim();
                    const content = contentInput.querySelector('textarea').value.trim();
                    if (!title || !content) {
                        Components.Toast('Preencha o título e o texto da redação', 'warning');
                        return;
                    }
                    try {
                        if (isEdit) {
                            await api.updateEssay(existingEssay.id, { title, content });
                            Components.Toast('Redação atualizada com sucesso', 'success');
                        } else {
                            await api.createEssay({ title, content });
                            Components.Toast('Redação salva com sucesso', 'success');
                        }
                        modal.remove();
                        state.setState({ _essaysLoaded: false });
                    } catch (err) {
                        Components.Toast(err.message, 'error');
                    }
                }, 'primary')
            ]);
            document.body.appendChild(modal);
        };
        const openCreateModal = () => openEssayModal(null);

        const openCorrection = (essay) => {
            const body = createElement('div', {},
                createElement('p', { className: 'text-sm mb-4', style: { color: 'var(--ink-soft)' } }, 'A correção verifica gramática, ortografia e pontuação através de um serviço externo gratuito (LanguageTool) — o texto da redação é enviado para esse serviço no momento da correção. É um primeiro retorno automático; não avalia argumentação e não substitui a avaliação de um professor.'),
                essay.score !== null && essay.score !== undefined
                    ? createElement('div', {},
                        createElement('p', { className: 'text-3xl font-bold mono-face mb-2', style: { color: 'var(--accent)' } }, `${essay.score}/1000`),
                        createElement('p', { className: 'text-sm', style: { color: 'var(--ink)' } }, essay.feedback || '')
                      )
                    : createElement('p', { className: 'text-sm', style: { color: 'var(--ink-soft)' } }, 'Esta redação ainda não foi corrigida.')
            );
            const modal = Components.Modal(essay.title, body, [
                Components.Button('Fechar', () => modal.remove(), 'secondary'),
                (essay.score === null || essay.score === undefined) ? Components.Button('Corrigir agora', async () => {
                    try {
                        await api.correctEssay(essay.id);
                        Components.Toast('Redação corrigida!', 'success');
                        modal.remove();
                        state.setState({ _essaysLoaded: false });
                        // Corrigir uma redação também ganha XP no backend.
                        _dashboardStatsLoaded = false;
                        state.invalidateStats();
                    } catch (err) {
                        Components.Toast(err.message, 'error');
                    }
                }, 'primary') : null
            ]);
            document.body.appendChild(modal);
        };

        const removeEssay = (essay) => {
            Components.ConfirmModal('Remover redação', `Remover a redação "${essay.title}"? Essa ação não pode ser desfeita.`, async () => {
                try {
                    await api.deleteEssay(essay.id);
                    Components.Toast('Redação removida', 'success');
                    state.setState({ _essaysLoaded: false });
                } catch (err) {
                    Components.Toast(err.message, 'error');
                }
            });
        };

        const list = essays.length > 0
            ? createElement('div', { className: 'grid grid-cols-1 md:grid-cols-2 gap-5' },
                essays.map(essay =>
                    Components.Card(essay.title,
                        createElement('div', {},
                            createElement('p', { className: 'text-sm truncate-lines mb-3', style: { color: 'var(--ink-soft)' } }, essay.content),
                            essay.score !== null && essay.score !== undefined
                                ? Components.Badge(`${essay.score}/1000`, 'success')
                                : Components.Badge('Aguardando correção', 'warning')
                        ),
                        'pen-fancy',
                        () => openCorrection(essay),
                        [
                            { icon: 'edit', title: 'Editar', onClick: () => openEssayModal(essay) },
                            { icon: 'trash', title: 'Remover', danger: true, onClick: () => removeEssay(essay) }
                        ]
                    )
                )
            )
            : Components.EmptyState('pen-fancy', 'Nenhuma redação ainda', 'Escreva sua primeira redação e receba uma correção automática',
                Components.Button('Escrever redação', openCreateModal, 'primary')
            );

        const content = Components.Container([
            createElement('div', { className: 'flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-8' },
                createElement('h2', { className: 'text-2xl font-semibold display-face', style: { color: 'var(--ink)' } }, 'Suas redações'),
                essays.length > 0 ? Components.Button('+ Nova redação', openCreateModal, 'primary') : null
            ),
            list
        ]);

        main.appendChild(content);
        return main;
    },

    // ========================================
    // EXAMS SCREEN (Agenda de provas / vestibulares)
    // ========================================

    ExamsScreen: () => {
        const main = createElement('main', { className: 'flex-1' });
        main.appendChild(Components.Header('Agenda de provas'));

        if (!_examsFetchInFlight && !state.get('_examsLoaded')) {
            _examsFetchInFlight = true;
            state.loadExams().finally(() => {
                _examsFetchInFlight = false;
                state.setState({ _examsLoaded: true });
            });
        }

        const exams = (state.get('exams') || []).slice().sort((a, b) => new Date(a.date) - new Date(b.date));

        const openExamModal = (existingExam = null) => {
            const isEdit = !!existingExam;
            const titleInput = Components.Input('Nome da prova', 'text', 'Ex: ENEM, FUVEST, UERJ...', existingExam?.title || '', null, 'graduation-cap');
            const subjectInput = Components.Input('Foco / matéria principal', 'text', 'Ex: Redação e Linguagens', existingExam?.subject || '', null, 'book');
            const dateInput = Components.Input('Data da prova', 'date', '', existingExam?.date ? existingExam.date.slice(0, 10) : '', null, 'calendar');
            const locationInput = Components.Input('Local (opcional)', 'text', 'Ex: Escola X, sala 12', existingExam?.location || '', null, 'map-marker-alt');
            const body = createElement('div', {}, titleInput, subjectInput, dateInput, locationInput);

            const modal = Components.Modal(isEdit ? 'Editar prova' : 'Nova prova na agenda', body, [
                Components.Button('Cancelar', () => modal.remove(), 'secondary'),
                Components.Button('Salvar', async () => {
                    const title = titleInput.querySelector('input').value.trim();
                    const subject = subjectInput.querySelector('input').value.trim();
                    const date = dateInput.querySelector('input').value;
                    const location = locationInput.querySelector('input').value.trim();
                    if (!title || !subject || !date) {
                        Components.Toast('Preencha nome, matéria e data', 'warning');
                        return;
                    }
                    try {
                        const payload = { title, subject, date: new Date(date).toISOString(), location: location || null };
                        if (isEdit) {
                            await api.updateExam(existingExam.id, payload);
                            Components.Toast('Prova atualizada com sucesso', 'success');
                        } else {
                            await api.createExam(payload);
                            Components.Toast('Prova adicionada à agenda', 'success');
                        }
                        modal.remove();
                        state.setState({ _examsLoaded: false });
                    } catch (err) {
                        Components.Toast(err.message, 'error');
                    }
                }, 'primary')
            ]);
            document.body.appendChild(modal);
        };
        const openCreateModal = () => openExamModal(null);

        const removeExam = (exam) => {
            Components.ConfirmModal('Remover prova', `Remover "${exam.title}" da agenda? Essa ação não pode ser desfeita.`, async () => {
                try {
                    await api.deleteExam(exam.id);
                    Components.Toast('Prova removida da agenda', 'success');
                    state.setState({ _examsLoaded: false });
                } catch (err) {
                    Components.Toast(err.message, 'error');
                }
            });
        };

        const daysUntil = (dateStr) => {
            const diff = new Date(dateStr) - new Date();
            return Math.ceil(diff / (1000 * 60 * 60 * 24));
        };

        const list = exams.length > 0
            ? createElement('div', { className: 'space-y-3' },
                exams.map(exam => {
                    const days = daysUntil(exam.date);
                    const urgent = days <= 7 && days >= 0;
                    return createElement('div', { className: 'card p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3' },
                        createElement('div', {},
                            createElement('p', { className: 'font-medium', style: { color: 'var(--ink)' } }, exam.title),
                            createElement('p', { className: 'text-sm', style: { color: 'var(--ink-soft)' } }, exam.subject),
                            exam.location ? createElement('p', { className: 'text-xs mono-face', style: { color: 'var(--ink-faint)' } }, exam.location) : null
                        ),
                        createElement('div', { className: 'flex items-center gap-3' },
                            createElement('div', { className: 'text-right' },
                                createElement('p', { className: 'text-sm mono-face font-semibold', style: { color: 'var(--ink)' } }, new Date(exam.date).toLocaleDateString('pt-BR')),
                                Components.Badge(
                                    days < 0 ? 'Já passou' : days === 0 ? 'É hoje!' : `em ${days} dia${days === 1 ? '' : 's'}`,
                                    urgent ? 'danger' : 'primary'
                                )
                            ),
                            createElement('button', {
                                className: 'p-2 rounded-lg hover:bg-[var(--surface-line)]',
                                onClick: () => openExamModal(exam),
                                title: 'Editar'
                            }, createElement('i', { className: 'fas fa-edit', style: { color: 'var(--ink-faint)' } })),
                            createElement('button', {
                                className: 'p-2 rounded-lg hover:bg-[var(--surface-line)]',
                                onClick: () => removeExam(exam),
                                title: 'Remover'
                            }, createElement('i', { className: 'fas fa-trash', style: { color: 'var(--ink-faint)' } }))
                        )
                    );
                })
            )
            : Components.EmptyState('calendar-alt', 'Nenhuma prova na agenda', 'Adicione as datas do ENEM e dos vestibulares que você vai prestar',
                Components.Button('Adicionar prova', openCreateModal, 'primary')
            );

        const content = Components.Container([
            createElement('div', { className: 'flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-8' },
                createElement('h2', { className: 'text-2xl font-semibold display-face', style: { color: 'var(--ink)' } }, 'Sua agenda de provas'),
                exams.length > 0 ? Components.Button('+ Nova prova', openCreateModal, 'primary') : null
            ),
            list
        ]);

        main.appendChild(content);
        return main;
    },

    // ========================================
    // STATISTICS SCREEN
    // ========================================

    StatsScreen: () => {
        const main = createElement('main', { className: 'flex-1' });
        main.appendChild(Components.Header('Estatísticas'));

        if (!_statsScreenFetchInFlight && !state.get('stats')) {
            _statsScreenFetchInFlight = true;
            state.loadStats().finally(() => { _statsScreenFetchInFlight = false; });
        }
        if (!_enemStatsFetchInFlight && !state.get('enemStats')) {
            _enemStatsFetchInFlight = true;
            api.getEnemStats()
                .then(enemStats => state.setState({ enemStats }))
                .catch(err => warn('Não foi possível carregar estatísticas do ENEM:', err.message))
                .finally(() => { _enemStatsFetchInFlight = false; });
        }

        const stats = state.get('stats');
        const achievements = state.get('achievements');
        const enemStats = state.get('enemStats');

        if (!stats) {
            main.appendChild(Components.Container(Components.Loading()));
            return main;
        }

        const earned = (achievements && achievements.earned) || [];
        const available = (achievements && achievements.available) || [];
        const weekly = stats.weekly_study_hours || [];
        const subjects = stats.subject_distribution || [];

        // Rótulo pequeno acima de cada seção — dá hierarquia visual clara entre os
        // blocos da página em vez de vários cards soltos, um em cima do outro.
        const sectionLabel = (text) => createElement('h3', {
            className: 'text-xs font-semibold uppercase mb-3',
            style: { color: 'var(--ink-faint)', letterSpacing: '0.06em' }
        }, text);

        const overviewSection = createElement('div', {},
            sectionLabel('Visão geral'),
            createElement('div', { className: 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4' },
                Components.StatCard('Nível', stats.level, 'trophy', 'purple'),
                Components.StatCard('Sequência', `${stats.streak_days} dias`, 'fire', 'orange'),
                Components.StatCard('Total de XP', stats.xp.toLocaleString('pt-BR'), 'star', 'indigo'),
                Components.StatCard('Tarefas concluídas', stats.tasks_completed, 'check-circle', 'green'),
                Components.StatCard('Questões respondidas', stats.questions_answered, 'question-circle', 'blue'),
                Components.StatCard('Média de acertos', `${stats.average_score.toFixed(0)}%`, 'chart-line', 'indigo')
            )
        );

        const chartsSection = createElement('div', {},
            sectionLabel('Desempenho'),
            createElement('div', { className: 'grid grid-cols-1 lg:grid-cols-2 gap-6' },
                Components.Card('Horas de estudo — últimos 7 dias',
                    weekly.length > 0
                        ? createElement('div', { className: 'flex items-end gap-2 h-40' },
                            weekly.map(d =>
                                createElement('div', { className: 'flex-1 flex flex-col items-center gap-1' },
                                    createElement('div', {
                                        className: 'w-full rounded-t transition-all',
                                        style: { height: `${Math.min((d.hours / 5) * 100, 100)}%`, minHeight: '4px', background: 'var(--accent)' }
                                    }),
                                    createElement('span', { className: 'text-xs mono-face', style: { color: 'var(--ink-faint)' } }, d.day)
                                )
                            )
                        )
                        : createElement('p', { className: 'text-sm py-6 text-center', style: { color: 'var(--ink-soft)' } }, 'Sem dados de estudo ainda.'),
                    'calendar-week'
                ),
                Components.Card('Distribuição por matéria',
                    subjects.length > 0
                        ? createElement('div', { className: 'space-y-3' },
                            subjects.map(sub => {
                                const total = subjects.reduce((a, b) => a + (b.minutes || 0), 0);
                                const pct = total > 0 ? ((sub.minutes || 0) / total * 100) : 0;
                                return createElement('div', {},
                                    createElement('div', { className: 'flex justify-between text-sm mb-1' },
                                        createElement('span', { style: { color: 'var(--ink)' } }, sub.subject),
                                        createElement('span', { className: 'mono-face', style: { color: 'var(--ink-soft)' } }, `${pct.toFixed(0)}%`)
                                    ),
                                    createElement('div', { className: 'w-full rounded-full h-2', style: { background: 'var(--surface-line)' } },
                                        createElement('div', { className: 'rounded-full h-2', style: { width: `${pct}%`, background: 'var(--accent)' } })
                                    )
                                );
                            })
                        )
                        : createElement('p', { className: 'text-sm py-6 text-center', style: { color: 'var(--ink-soft)' } }, 'Comece a estudar matérias para ver a distribuição aqui.'),
                    'chart-pie'
                )
            )
        );

        const enemSection = (enemStats && enemStats.total_attempts > 0)
            ? createElement('div', {},
                sectionLabel('Simulado ENEM'),
                Components.Card('Desempenho no simulado ENEM',
                    createElement('div', {},
                        createElement('div', { className: 'flex items-center gap-6 mb-4' },
                            createElement('div', {},
                                createElement('p', { className: 'text-3xl font-bold mono-face', style: { color: 'var(--accent)' } }, `${enemStats.accuracy.toFixed(0)}%`),
                                createElement('p', { className: 'text-xs', style: { color: 'var(--ink-soft)' } }, 'de acerto geral')
                            ),
                            createElement('div', {},
                                createElement('p', { className: 'text-3xl font-bold mono-face', style: { color: 'var(--ink)' } }, `${enemStats.total_correct}/${enemStats.total_attempts}`),
                                createElement('p', { className: 'text-xs', style: { color: 'var(--ink-soft)' } }, 'questões respondidas')
                            )
                        ),
                        createElement('div', { className: 'space-y-3' },
                            enemStats.by_discipline.map(d =>
                                createElement('div', {},
                                    createElement('div', { className: 'flex justify-between text-sm mb-1' },
                                        createElement('span', { style: { color: 'var(--ink)' } }, d.discipline),
                                        createElement('span', { className: 'mono-face', style: { color: 'var(--ink-soft)' } }, `${d.correct}/${d.attempts} (${d.accuracy.toFixed(0)}%)`)
                                    ),
                                    createElement('div', { className: 'w-full rounded-full h-2', style: { background: 'var(--surface-line)' } },
                                        createElement('div', { className: 'rounded-full h-2', style: { width: `${d.accuracy}%`, background: 'var(--success)' } })
                                    )
                                )
                            )
                        )
                    ),
                    'graduation-cap'
                  )
              )
            : null;

        const achievementsSection = createElement('div', {},
            sectionLabel('Conquistas'),
            Components.Card('Suas conquistas',
                createElement('div', {},
                    earned.length > 0
                        ? createElement('div', {},
                            createElement('p', { className: 'text-xs font-semibold mb-3', style: { color: 'var(--ink-soft)' } }, `Conquistadas (${earned.length})`),
                            createElement('div', { className: 'flex gap-4 overflow-x-auto pb-2 mb-5 scrollbar-hide' },
                                earned.map(a =>
                                    createElement('div', { className: 'flex-shrink-0 w-24 text-center' },
                                        createElement('div', { className: 'stamp mx-auto mb-2', style: { color: 'var(--warning-deep)', borderColor: 'var(--warning-deep)', width: '56px', height: '56px' } },
                                            createElement('i', { className: `fas fa-${a.icon}` })
                                        ),
                                        createElement('p', { className: 'text-xs font-medium', style: { color: 'var(--ink)' } }, a.name)
                                    )
                                )
                            )
                        )
                        : createElement('p', { className: 'text-sm mb-5', style: { color: 'var(--ink-soft)' } }, 'Nenhuma conquista ainda — continue estudando!'),
                    available.length > 0
                        ? createElement('div', {},
                            createElement('p', { className: 'text-xs font-semibold mb-3', style: { color: 'var(--ink-soft)' } }, 'A desbloquear'),
                            createElement('div', { className: 'space-y-2' },
                                available.slice(0, 4).map(a =>
                                    createElement('div', {
                                        className: 'flex items-center gap-3 p-3 rounded-lg',
                                        style: { background: 'var(--surface)', border: '1px solid var(--surface-line)' }
                                    },
                                        createElement('div', {
                                            className: 'w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0',
                                            style: { background: 'var(--surface-card)' }
                                        }, createElement('i', { className: `fas fa-${a.icon}`, style: { color: 'var(--ink-faint)' } })),
                                        createElement('div', { className: 'flex-1 min-w-0' },
                                            createElement('p', { className: 'text-sm font-medium truncate-line', style: { color: 'var(--ink)' } }, a.name),
                                            createElement('p', { className: 'text-xs truncate-line', style: { color: 'var(--ink-soft)' } }, a.description)
                                        ),
                                        createElement('span', { className: 'text-xs mono-face flex-shrink-0', style: { color: 'var(--ink-faint)' } }, `+${a.xp_reward} XP`)
                                    )
                                )
                            )
                        )
                        : null
                ),
                'trophy'
            )
        );

        const content = Components.Container(
            createElement('div', { className: 'space-y-8' },
                overviewSection, chartsSection, enemSection, achievementsSection
            )
        );

        main.appendChild(content);
        return main;
    },

    // ========================================
    // PROFILE SCREEN
    // ========================================

    ProfileScreen: () => {
        const main = createElement('main', { className: 'flex-1' });
        main.appendChild(Components.Header('Perfil'));

        const currentUser = state.get('user');

        // Estatísticas (nível/XP/sequência) — mesmo padrão de carregamento único do Dashboard
        if (!state.get('stats') && !_profileStatsFetchInFlight) {
            _profileStatsFetchInFlight = true;
            state.loadStats().finally(() => { _profileStatsFetchInFlight = false; });
        }
        const stats = state.get('stats');
        const currentTheme = state.getTheme();

        const initials = (currentUser?.name || 'U').trim().split(/\s+/).slice(0, 2)
            .map(w => w[0]?.toUpperCase() || '').join('') || 'U';

        // --------- Foto de perfil ---------
        const avatarFileInput = createElement('input', {
            type: 'file',
            accept: 'image/*',
            style: { display: 'none' },
            onChange: async (e) => {
                const file = e.target.files && e.target.files[0];
                if (!file) return;
                try {
                    const updated = await api.uploadAvatar(file);
                    state.setState({ user: { ...state.get('user'), avatarUrl: updated.avatar_url || null } });
                    Components.Toast('Foto de perfil atualizada', 'success');
                } catch (err) {
                    Components.Toast(err.message, 'error');
                } finally {
                    avatarFileInput.value = '';
                }
            }
        });

        const avatarCircle = createElement('div', {
            className: 'w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold mono-face cursor-pointer',
            style: { background: 'var(--accent-panel-bg)', color: '#fff', overflow: 'hidden' },
            title: 'Alterar foto de perfil',
            onClick: () => avatarFileInput.click()
        },
            currentUser?.avatarUrl
                ? createElement('img', { src: currentUser.avatarUrl, alt: 'Foto de perfil', style: { width: '100%', height: '100%', objectFit: 'cover' } })
                : initials
        );

        const avatarBadge = createElement('button', {
            type: 'button',
            className: 'absolute flex items-center justify-center rounded-full',
            style: {
                width: '22px', height: '22px', right: '-2px', bottom: '-2px',
                background: 'var(--accent)', color: '#fff', border: '2px solid var(--surface-card)'
            },
            title: 'Alterar foto de perfil',
            onClick: () => avatarFileInput.click()
        }, createElement('i', { className: 'fas fa-camera', style: { fontSize: '10px' } }));

        const avatarWrapper = createElement('div', { className: 'relative flex-shrink-0', style: { width: '64px', height: '64px' } },
            avatarCircle, avatarBadge, avatarFileInput
        );

        // --------- Informações + resumo de progresso ---------
        const headerCard = Components.Card('Informações do perfil',
            createElement('div', {},
                createElement('div', { className: 'flex items-center gap-4 mb-6' },
                    avatarWrapper,
                    createElement('div', {},
                        createElement('h3', { className: 'text-xl font-semibold display-face', style: { color: 'var(--ink)' } }, currentUser?.name || 'Usuário'),
                        createElement('p', { style: { color: 'var(--ink-soft)' } }, currentUser?.email || '')
                    )
                ),
                stats
                    ? createElement('div', { className: 'grid grid-cols-3 gap-3' },
                        [['Nível', stats.level], ['XP', stats.xp], ['Sequência', `${stats.streak_days}d`]].map(([label, value]) =>
                            createElement('div', { className: 'text-center p-3 rounded-lg', style: { background: 'var(--surface)' } },
                                createElement('p', { className: 'text-lg font-bold mono-face', style: { color: 'var(--accent)' } }, String(value)),
                                createElement('p', { className: 'text-xs', style: { color: 'var(--ink-faint)' } }, label)
                            )
                        )
                      )
                    : Components.Loading()
            ),
            'user'
        );

        // --------- Editar perfil ---------
        const nameInput = Components.Input('Nome completo', 'text', '', currentUser?.name || '', null, 'user');
        const emailInput = Components.Input('E-mail', 'email', '', currentUser?.email || '', null, 'envelope');
        const saveProfileBtn = Components.Button('Salvar alterações', async () => {
            const full_name = nameInput.querySelector('input').value.trim();
            const email = emailInput.querySelector('input').value.trim();
            if (!full_name || !email) {
                Components.Toast('Preencha nome e e-mail', 'warning');
                return;
            }
            try {
                const updated = await api.updateProfile({ full_name, email });
                state.setState({ user: { ...state.get('user'), name: updated.full_name, email: updated.email } });
                Components.Toast('Perfil atualizado com sucesso', 'success');
            } catch (err) {
                Components.Toast(err.message, 'error');
            }
        }, 'primary');

        const editCard = Components.Card('Editar perfil',
            createElement('div', {}, nameInput, emailInput, saveProfileBtn),
            'edit'
        );

        // --------- Segurança (trocar senha) ---------
        const currentPwInput = Components.Input('Senha atual', 'password', '', '', null, 'lock');
        const newPwInput = Components.Input('Nova senha', 'password', '', '', null, 'key');
        const confirmPwInput = Components.Input('Confirmar nova senha', 'password', '', '', null, 'key');
        const savePwBtn = Components.Button('Atualizar senha', async () => {
            const currentPw = currentPwInput.querySelector('input').value;
            const newPw = newPwInput.querySelector('input').value;
            const confirmPw = confirmPwInput.querySelector('input').value;
            if (!currentPw || !newPw) {
                Components.Toast('Preencha a senha atual e a nova senha', 'warning');
                return;
            }
            if (newPw !== confirmPw) {
                Components.Toast('A confirmação não bate com a nova senha', 'warning');
                return;
            }
            try {
                await api.changePassword(currentPw, newPw);
                Components.Toast('Senha atualizada com sucesso', 'success');
                currentPwInput.querySelector('input').value = '';
                newPwInput.querySelector('input').value = '';
                confirmPwInput.querySelector('input').value = '';
            } catch (err) {
                Components.Toast(err.message, 'error');
            }
        }, 'primary');

        const securityCard = Components.Card('Segurança',
            createElement('div', {}, currentPwInput, newPwInput, confirmPwInput, savePwBtn),
            'shield-alt'
        );

        // --------- Aparência ---------
        const THEME_OPTIONS = [
            { id: 'light', label: 'Claro', icon: 'sun' },
            { id: 'dark', label: 'Escuro', icon: 'moon' },
            { id: 'glass', label: 'Vidro', icon: 'gem' }
        ];

        const appearanceCard = Components.Card('Aparência',
            createElement('div', {},
                createElement('p', { className: 'text-sm mb-4', style: { color: 'var(--ink-soft)' } }, 'Troca o tema de toda a plataforma. "Vidro" usa painéis translúcidos com desfoque, como no iOS.'),
                createElement('div', { className: 'flex flex-col sm:flex-row gap-3' },
                    THEME_OPTIONS.map(opt =>
                        Components.Button(
                            opt.label,
                            () => state.setTheme(opt.id),
                            opt.id === currentTheme ? 'primary' : 'secondary',
                            'medium',
                            opt.icon
                        )
                    )
                )
            ),
            'palette'
        );

        // --------- Conta ---------
        const accountCard = Components.Card('Conta',
            createElement('div', {},
                createElement('p', { className: 'text-sm mb-4', style: { color: 'var(--ink-soft)' } }, 'Encerrar a sessão neste dispositivo.'),
                Components.Button('Fazer logout', () => {
                    state.logout();
                    app.render();
                }, 'danger')
            ),
            'sign-out-alt'
        );

        const content = Components.Container(
            createElement('div', { className: 'max-w-2xl mx-auto space-y-6' },
                headerCard, editCard, securityCard, appearanceCard, accountCard
            )
        );

        main.appendChild(content);
        return main;
    }
};

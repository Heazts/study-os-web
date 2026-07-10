/**
 * COMPONENTS.JS - Componentes reutilizáveis da UI
 */

const Components = {
    // ========================================
    // LAYOUT
    // ========================================

    Header: (title, showMenu = true) => {
        const currentTheme = state.getTheme();
        // Ícone/título mostram o tema para o qual o clique vai levar (destino),
        // não o atual — mesma convenção de antes, agora com 3 estados em vez de 2.
        const THEME_TOGGLE_NEXT = {
            light: { icon: 'moon', label: 'Mudar para modo escuro' },
            dark: { icon: 'gem', label: 'Mudar para modo vidro' },
            glass: { icon: 'sun', label: 'Mudar para modo claro' }
        };
        const themeToggle = THEME_TOGGLE_NEXT[currentTheme] || THEME_TOGGLE_NEXT.light;
        const avatarUrl = state.get('user')?.avatarUrl;
        return createElement('header', { className: 'app-header sticky top-0 z-50' },
            createElement('div', { className: 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex justify-between items-center' },
                createElement('div', { className: 'flex items-center gap-4 min-w-0' },
                    showMenu ? createElement('button', {
                        className: 'p-2 rounded-lg hover:bg-[var(--surface-line)] lg:hidden',
                        id: 'menu-toggle'
                    }, createElement('i', { className: 'fas fa-bars', style: { color: 'var(--ink)' } })) : null,
                    createElement('h1', { className: 'text-xl sm:text-2xl display-face font-semibold truncate-line' }, title)
                ),
                createElement('div', { className: 'flex items-center gap-2 flex-shrink-0' },
                    createElement('button', {
                        className: 'p-2 rounded-lg hover:bg-[var(--surface-line)]',
                        title: themeToggle.label,
                        onClick: () => state.toggleTheme()
                    }, createElement('i', { className: `fas fa-${themeToggle.icon}`, style: { color: 'var(--ink-soft)' } })),
                    createElement('button', {
                        className: 'p-2 rounded-lg hover:bg-[var(--surface-line)]',
                        title: 'Notificações'
                    }, createElement('i', { className: 'fas fa-bell', style: { color: 'var(--ink-soft)' } })),
                    createElement('button', {
                        className: 'p-2 rounded-lg hover:bg-[var(--surface-line)]',
                        id: 'user-menu'
                    }, avatarUrl
                        ? createElement('img', {
                            src: avatarUrl,
                            alt: 'Perfil',
                            style: { width: '22px', height: '22px', borderRadius: '50%', objectFit: 'cover', display: 'block' }
                          })
                        : createElement('i', { className: 'fas fa-user-circle', style: { color: 'var(--ink-soft)', fontSize: '20px' } }))
                )
            )
        );
    },

    Sidebar: (items) => {
        const sidebar = createElement('aside', { className: 'w-64 sidebar' });

        sidebar.appendChild(createElement('div', { className: 'sidebar-brand' },
            createElement('span', { className: 'mark' }, 'Study', createElement('span', {}, 'OS'))
        ));

        const nav = createElement('nav', { className: 'pb-6 space-y-1' });

        items.forEach(item => {
            const link = createElement('a', {
                href: '#',
                className: `sidebar-item ${item.active ? 'active' : ''}`,
                'data-page': item.id,
                onClick: (e) => {
                    e.preventDefault();
                    state.setState({ currentPage: item.id });
                    // No mobile a sidebar fica sobreposta à tela; fecha ao navegar.
                    if (window.app && typeof window.app.closeMobileSidebar === 'function') {
                        window.app.closeMobileSidebar();
                    }
                }
            },
                createElement('i', { className: `fas fa-${item.icon}` }),
                item.label
            );
            nav.appendChild(link);
        });

        sidebar.appendChild(nav);
        return sidebar;
    },

    Container: (children, className = '') => {
        const container = createElement('div', {
            className: `max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 ${className}`
        });
        if (Array.isArray(children)) {
            // Ignora null/undefined/false — igual ao createElement — para permitir
            // itens condicionais (`condicao ? Componente(...) : null`) direto no
            // array, sem quebrar com "parameter 1 is not of type 'Node'".
            children.forEach(child => {
                if (child === null || child === undefined || child === false) return;
                container.appendChild(child);
            });
        } else {
            container.appendChild(children);
        }
        return container;
    },

    // ========================================
    // FORMS
    // ========================================

    Input: (label, type = 'text', placeholder = '', value = '', onChange = null, icon = null) => {
        const wrapper = createElement('div', { className: 'mb-4' });
        
        if (label) {
            wrapper.appendChild(createElement('label', { className: 'label' }, label));
        }

        const inputGroup = createElement('div', { className: 'input-group' });
        if (icon) {
            inputGroup.appendChild(createElement('i', { 
                className: `fas fa-${icon} input-icon` 
            }));
        }

        const input = createElement('input', {
            type,
            placeholder,
            className: 'input-field',
            value,
            onChange
        });

        inputGroup.appendChild(input);
        wrapper.appendChild(inputGroup);

        return wrapper;
    },

    Textarea: (label, placeholder = '', value = '', onChange = null) => {
        const wrapper = createElement('div', { className: 'mb-4' });
        
        if (label) {
            wrapper.appendChild(createElement('label', { className: 'label' }, label));
        }

        const textarea = createElement('textarea', {
            placeholder,
            className: 'input-field resize-vertical',
            value,
            onChange,
            rows: 6
        });

        wrapper.appendChild(textarea);
        return wrapper;
    },

    Select: (label, options = [], value = '', onChange = null) => {
        const wrapper = createElement('div', { className: 'mb-4' });
        
        if (label) {
            wrapper.appendChild(createElement('label', { className: 'label' }, label));
        }

        const select = createElement('select', {
            className: 'input-field',
            onChange
        });

        options.forEach(option => {
            // "selected" precisa ser um atributo booleano na <option> certa —
            // setar "value" no <select> não move a seleção visual em HTML puro.
            // eslint-disable-next-line eqeqeq
            const isSelected = option.value == value;
            select.appendChild(createElement('option', {
                value: option.value,
                selected: isSelected
            }, option.label));
        });

        wrapper.appendChild(select);
        return wrapper;
    },

    // ========================================
    // BUTTONS
    // ========================================

    Button: (label, onClick = null, variant = 'primary', size = 'medium', icon = null, disabled = false) => {
        const button = createElement('button', {
            className: `btn btn-${variant} btn-${size} ${disabled ? 'disabled' : ''}`,
            onClick,
            disabled
        });

        button.disabled = Boolean(disabled);
        button.classList.toggle('disabled', Boolean(disabled));
        button.setAttribute('aria-disabled', Boolean(disabled) ? 'true' : 'false');

        if (icon) {
            button.appendChild(createElement('i', { className: `fas fa-${icon}` }));
        }
        button.appendChild(document.createTextNode(label));

        return button;
    },

    ButtonGroup: (buttons) => {
        const group = createElement('div', { className: 'flex gap-3 mt-6' });
        buttons.forEach(btn => group.appendChild(btn));
        return group;
    },

    // ========================================
    // CARDS
    // ========================================

    // "actions" é uma lista de { icon, onClick, title, danger } — cada uma vira
    // um botão de ícone no canto do card (ex.: editar/apagar), sem disparar o
    // onClick do card inteiro (usado, por ex., para abrir um modal de detalhe).
    Card: (title, content, icon = null, onClick = null, actions = null) => {
        const card = createElement('div', {
            className: `card p-6 ${onClick ? 'cursor-pointer' : ''}`,
            onClick
        });

        const header = createElement('div', { className: 'flex items-start justify-between mb-4' });

        const titleGroup = createElement('div', { className: 'flex items-start gap-3 min-w-0' });
        if (icon) {
            const iconEl = createElement('div', {
                className: 'w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0',
                style: { background: 'rgba(0,113,227,0.08)' }
            }, createElement('i', { className: `fas fa-${icon} text-xl`, style: { color: 'var(--accent)' } }));
            titleGroup.appendChild(iconEl);
        }
        titleGroup.appendChild(createElement('h3', { className: 'text-lg font-semibold display-face truncate-line', style: { color: 'var(--ink)' } }, title));
        header.appendChild(titleGroup);

        if (actions && actions.length > 0) {
            const actionsGroup = createElement('div', { className: 'flex items-center gap-1 flex-shrink-0' },
                actions.map(action =>
                    createElement('button', {
                        className: 'p-2 rounded-lg hover:bg-[var(--surface-line)]',
                        onClick: (e) => {
                            e.stopPropagation();
                            action.onClick();
                        },
                        title: action.title || ''
                    }, createElement('i', { className: `fas fa-${action.icon}`, style: { color: action.danger ? 'var(--danger)' : 'var(--ink-faint)' } }))
                )
            );
            header.appendChild(actionsGroup);
        }

        card.appendChild(header);

        if (typeof content === 'string') {
            card.appendChild(createElement('p', { className: 'text-sm', style: { color: 'var(--ink-soft)' } }, content));
        } else {
            card.appendChild(content);
        }

        return card;
    },

    StatCard: (label, value, icon, color = 'indigo') => {
        const colors = {
            indigo: { bg: 'rgba(94,92,230,0.12)', fg: '#5E5CE6' },
            green: { bg: 'rgba(52,199,89,0.14)', fg: 'var(--success-deep)' },
            blue: { bg: 'rgba(0,113,227,0.1)', fg: 'var(--accent)' },
            orange: { bg: 'rgba(255,149,0,0.16)', fg: '#9A5B00' },
            purple: { bg: 'rgba(175,82,222,0.14)', fg: '#AF52DE' }
        };
        const c = colors[color] || colors.indigo;

        return createElement('div', { className: 'card p-6 text-center' },
            createElement('div', {
                className: 'w-12 h-12 rounded-lg flex items-center justify-center mx-auto mb-4',
                style: { background: c.bg }
            },
                createElement('i', { className: `fas fa-${icon} text-xl`, style: { color: c.fg } })
            ),
            createElement('div', { className: 'text-3xl font-bold mono-face mb-1', style: { color: 'var(--ink)' } }, value),
            createElement('p', { className: 'text-sm', style: { color: 'var(--ink-soft)' } }, label)
        );
    },

    // ========================================
    // ALERTS & NOTIFICATIONS
    // ========================================

    Alert: (message, type = 'info', dismissible = true) => {
        const alert = createElement('div', { className: `alert alert-${type}` });
        
        const icon = {
            info: 'info-circle',
            success: 'check-circle',
            warning: 'exclamation-triangle',
            danger: 'exclamation-circle'
        }[type];

        alert.appendChild(createElement('i', { className: `fas fa-${icon}` }));
        alert.appendChild(createElement('div', { className: 'flex-1' }, message));

        if (dismissible) {
            const closeBtn = createElement('button', {
                className: 'ml-4',
                style: { color: 'var(--ink-faint)' },
                onClick: () => alert.remove()
            }, createElement('i', { className: 'fas fa-times' }));
            alert.appendChild(closeBtn);
        }

        return alert;
    },

    Toast: (message, type = 'success', duration = 3000) => {
        const toast = createElement('div', { className: `toast ${type}` }, message);
        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'slideIn 0.3s ease reverse';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    },

    // ========================================
    // MODAL
    // ========================================

    /** Modal de confirmação (ex.: apagar algo) com a mesma linguagem visual do
     *  resto do app — substitui o confirm() nativo do navegador, que quebra o
     *  visual (janela cinza do sistema, sem nada a ver com o tema claro/escuro/vidro). */
    ConfirmModal: (title, message, onConfirm, confirmLabel = 'Remover', variant = 'danger') => {
        const modal = Components.Modal(title,
            createElement('p', { className: 'text-sm', style: { color: 'var(--ink-soft)' } }, message),
            [
                Components.Button('Cancelar', () => modal.remove(), 'secondary'),
                Components.Button(confirmLabel, () => {
                    modal.remove();
                    onConfirm();
                }, variant)
            ]
        );
        document.body.appendChild(modal);
        return modal;
    },

    Modal: (title, content, footer = null) => {
        const backdrop = createElement('div', { className: 'modal-backdrop' });
        
        const modal = createElement('div', { className: 'modal' });
        
        const header = createElement('div', { className: 'modal-header' });
        header.appendChild(createElement('h2', { className: 'text-xl font-bold' }, title));
        header.appendChild(createElement('button', {
            style: { color: 'var(--ink-faint)' },
            onClick: () => backdrop.remove()
        }, createElement('i', { className: 'fas fa-times text-xl' })));
        modal.appendChild(header);

        const body = createElement('div', { className: 'modal-body' });
        if (typeof content === 'string') {
            body.textContent = content;
        } else {
            body.appendChild(content);
        }
        modal.appendChild(body);

        if (footer) {
            const footerEl = createElement('div', { className: 'modal-footer' });
            if (Array.isArray(footer)) {
                footer.forEach(btn => footerEl.appendChild(btn));
            } else {
                footerEl.appendChild(footer);
            }
            modal.appendChild(footerEl);
        }

        backdrop.appendChild(modal);
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) backdrop.remove();
        });

        return backdrop;
    },

    // ========================================
    // LISTS
    // ========================================

    List: (items, renderItem) => {
        const list = createElement('div', { className: 'space-y-3' });
        items.forEach(item => {
            const listItem = createElement('div', { className: 'card p-4 flex items-center justify-between' });
            listItem.appendChild(renderItem(item));
            list.appendChild(listItem);
        });
        return list;
    },

    // ========================================
    // BADGES
    // ========================================

    Badge: (label, type = 'primary') => {
        return createElement('span', { className: `badge badge-${type}` }, label);
    },

    // ========================================
    // LOADING STATE
    // ========================================

    Loading: () => {
        return createElement('div', { className: 'flex items-center justify-center p-8' },
            createElement('div', { className: 'text-center' },
                createElement('div', { className: 'inline-block animate-spin mb-4' },
                    createElement('i', { className: 'fas fa-spinner text-4xl', style: { color: 'var(--accent)' } })
                ),
                createElement('p', { className: 'mt-4', style: { color: 'var(--ink-soft)' } }, 'Carregando...')
            )
        );
    },

    // ========================================
    // EMPTY STATE
    // ========================================

    EmptyState: (icon, title, message, action = null) => {
        const empty = createElement('div', { className: 'flex flex-col items-center justify-center p-12' });
        
        empty.appendChild(createElement('div', { className: 'text-6xl mb-4', style: { color: 'var(--surface-line)' } },
            createElement('i', { className: `fas fa-${icon}` })
        ));
        
        empty.appendChild(createElement('h3', { className: 'text-xl font-semibold display-face mb-2', style: { color: 'var(--ink)' } }, title));
        empty.appendChild(createElement('p', { className: 'text-center max-w-sm', style: { color: 'var(--ink-soft)' } }, message));
        
        if (action) {
            empty.appendChild(action);
        }

        return empty;
    }
};

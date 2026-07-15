import pg from 'pg';
import promptSync from 'prompt-sync';

const { Client } = pg;
const prompt = promptSync();

// Função que cria um client novo a cada chamada.
// Isso evita o erro de "conexão já fechada" quando várias funções
// são chamadas em sequência dentro do menu.
function criarCliente() {
    return new Client({
        host:     'localhost',   // onde o banco está rodando
        port:     5432,          // porta padrão do PostgreSQL
        user:     'postgres',    // usuário do banco
        password: 'sua_senha',   // TROQUE pela senha do seu postgres
        database: 'alquimista_db'
    });
}

// ──────────────────────────────────────────────
// Registra uma movimentação no log de auditoria.
// Reaproveita o client já conectado da função que chamou.
// ──────────────────────────────────────────────
async function registrarMovimentacao(client, usuario, acao, itemId, itemNome, detalhes) {
    try {
        await client.query(
            `INSERT INTO movimentacoes (usuario, acao, item_id, item_nome, detalhes)
             VALUES ($1, $2, $3, $4, $5)`,
            [usuario, acao, itemId, itemNome, detalhes]
        );
    } catch (erro) {
        console.log('⚠️  Não foi possível registrar a movimentação:', erro.message);
    }
}

// ──────────────────────────────────────────────
// LOGIN — Procura o usuário em administradores, depois em operarios.
// Devolve { login, perfil } ou null.
// ──────────────────────────────────────────────
async function login() {
    const client = criarCliente();

    try {
        await client.connect();

        console.log('\n🔐 ACESSO À LOJA DO ALQUIMISTA\n');
        const loginDigitado = prompt('Usuário: ');
        const senhaDigitada = prompt('Senha: ');

        // Primeiro tenta como administrador
        const resultadoAdm = await client.query(
            'SELECT login FROM administradores WHERE login = $1 AND senha = $2',
            [loginDigitado, senhaDigitada]
        );

        if (resultadoAdm.rows.length > 0) {
            console.log(`\n✅ Bem-vindo(a), ${resultadoAdm.rows[0].login}! (perfil: adm)`);
            await registrarMovimentacao(client, loginDigitado, 'LOGIN', null, null, 'Login realizado como administrador');
            return { login: resultadoAdm.rows[0].login, perfil: 'adm' };
        }

        // Se não achou, tenta como operário
        const resultadoOp = await client.query(
            'SELECT login FROM operarios WHERE login = $1 AND senha = $2',
            [loginDigitado, senhaDigitada]
        );

        if (resultadoOp.rows.length > 0) {
            console.log(`\n✅ Bem-vindo(a), ${resultadoOp.rows[0].login}! (perfil: operario)`);
            await registrarMovimentacao(client, loginDigitado, 'LOGIN', null, null, 'Login realizado como operário');
            return { login: resultadoOp.rows[0].login, perfil: 'operario' };
        }

        // Não encontrado em nenhuma das duas tabelas
        console.log('\n❌ Usuário ou senha inválidos.');
        await registrarMovimentacao(client, loginDigitado || '(vazio)', 'LOGIN_FALHA', null, null, 'Tentativa de login com credenciais inválidas');
        return null;

    } catch (erro) {
        console.log('❌ Erro ao fazer login:', erro.message);
        return null;
    } finally {
        await client.end();
    }
}

// ──────────────────────────────────────────────
// INSERT — Cadastrar novo usuário (somente admin).
// Insere na tabela administradores ou operarios, dependendo do perfil escolhido.
// ──────────────────────────────────────────────
async function cadastrarUsuario(usuarioLogado) {
    const client = criarCliente();

    try {
        await client.connect();

        console.log('\n👤 CADASTRAR NOVO USUÁRIO\n');

        const loginNovo  = prompt('Login: ').trim();
        const senhaNova  = prompt('Senha: ').trim();
        const nomeNovo   = prompt('Nome completo: ').trim();
        const perfilNovo = prompt('Perfil (adm/operario): ').trim().toLowerCase();

        if (!loginNovo || !senhaNova) {
            console.log('❌ Login e senha são obrigatórios.');
            return;
        }

        if (perfilNovo !== 'adm' && perfilNovo !== 'operario') {
            console.log('❌ Perfil inválido. Use "adm" ou "operario".');
            return;
        }

        const tabela = perfilNovo === 'adm' ? 'administradores' : 'operarios';

        const resultado = await client.query(
            `INSERT INTO ${tabela} (login, senha, nome)
             VALUES ($1, $2, $3)
             RETURNING id, login`,
            [loginNovo, senhaNova, nomeNovo]
        );

        console.log('\n✅ Usuário cadastrado com sucesso!');
        console.log(`   ${resultado.rows[0].login} — perfil: ${perfilNovo}`);

        await registrarMovimentacao(
            client,
            usuarioLogado,
            'INSERT_USUARIO',
            resultado.rows[0].id,
            resultado.rows[0].login,
            `Novo usuário cadastrado na tabela "${tabela}"`
        );

    } catch (erro) {
        if (erro.code === '23505') {
            console.log('❌ Esse login já está em uso. Escolha outro.');
        } else {
            console.log('❌ Erro ao cadastrar usuário:', erro.message);
        }
    } finally {
        await client.end();
    }
}

// ──────────────────────────────────────────────
// SELECT — Listar produtos + estoque (com filtro por tipo e paginação)
// produtos e estoque são tabelas separadas, então usamos JOIN.
// ──────────────────────────────────────────────
async function listarItens() {
    const client = criarCliente();

    try {
        await client.connect();

        console.log('\n╔════════════════════════════════════════════════════╗');
        console.log('║         ⚗️  LOJA DO ALQUIMISTA VALDRIS              ║');
        console.log('╚════════════════════════════════════════════════════╝\n');

        console.log('Filtrar por tipo (Poção / Ingrediente / Elixir)');
        const filtroTipo = prompt('Digite o tipo ou pressione Enter para ver todos: ').trim();

        const porPaginaInput = prompt('Itens por página (Enter para 5): ').trim();
        const itensPorPagina = parseInt(porPaginaInput) > 0 ? parseInt(porPaginaInput) : 5;

        let pagina = 1;
        let continuar = true;

        while (continuar) {
            const offset = (pagina - 1) * itensPorPagina;

            const baseSelect = `
                SELECT p.id, p.nome, p.tipo, p.preco, p.descricao, e.quantidade AS estoque
                FROM produtos p
                JOIN estoque e ON e.produto_id = p.id
            `;
            const baseCount = `
                SELECT COUNT(*) FROM produtos p
                JOIN estoque e ON e.produto_id = p.id
            `;

            let resultado, totalResultado;

            if (filtroTipo) {
                resultado = await client.query(
                    `${baseSelect} WHERE p.tipo ILIKE $1 ORDER BY p.tipo, p.nome LIMIT $2 OFFSET $3`,
                    [filtroTipo, itensPorPagina, offset]
                );
                totalResultado = await client.query(
                    `${baseCount} WHERE p.tipo ILIKE $1`,
                    [filtroTipo]
                );
            } else {
                resultado = await client.query(
                    `${baseSelect} ORDER BY p.tipo, p.nome LIMIT $1 OFFSET $2`,
                    [itensPorPagina, offset]
                );
                totalResultado = await client.query(baseCount);
            }

            const totalItens   = parseInt(totalResultado.rows[0].count);
            const totalPaginas = Math.max(1, Math.ceil(totalItens / itensPorPagina));

            console.log(`\n── Página ${pagina} de ${totalPaginas} ${filtroTipo ? `(filtro: ${filtroTipo})` : ''} ──\n`);

            if (resultado.rows.length === 0) {
                console.log('Nenhum item encontrado.');
            } else {
                resultado.rows.forEach(item => {
                    console.log(`[${item.id}] ${item.nome}`);
                    console.log(`    Tipo: ${item.tipo} | Preço: R$ ${item.preco} | Estoque: ${item.estoque}`);
                    console.log(`    ${item.descricao}`);
                    console.log('    ─────────────────────────────────────────');
                });
            }

            console.log(`\nTotal de itens encontrados: ${totalItens}`);
            console.log('[N] Próxima página   [P] Página anterior   [S] Sair da listagem');
            const opcao = prompt('Opção: ').trim().toLowerCase();

            if (opcao === 'n') {
                if (pagina < totalPaginas) pagina++;
                else console.log('⚠️  Você já está na última página.');
            } else if (opcao === 'p') {
                if (pagina > 1) pagina--;
                else console.log('⚠️  Você já está na primeira página.');
            } else {
                continuar = false;
            }
        }

    } catch (erro) {
        console.log('❌ Erro ao listar itens:', erro.message);
    } finally {
        await client.end();
    }
}

// ──────────────────────────────────────────────
// INSERT — Cadastrar novo produto + seu estoque inicial.
// Usamos uma TRANSAÇÃO (BEGIN/COMMIT/ROLLBACK): ou os dois INSERTs
// dão certo juntos, ou nenhum é salvo. Isso evita um produto "órfão"
// sem linha de estoque, caso o segundo INSERT falhe.
// ──────────────────────────────────────────────
async function cadastrarItem(usuarioLogado) {
    const client = criarCliente();

    try {
        await client.connect();

        console.log('\n⚗️  CADASTRAR NOVO ITEM\n');

        const nome      = prompt('Nome do item: ');
        const tipo      = prompt('Tipo (Poção/Ingrediente/Elixir): ');
        const preco     = prompt('Preço: ');
        const estoque   = prompt('Estoque inicial: ');
        const descricao = prompt('Descrição: ');

        if (!nome || !tipo || !preco) {
            console.log('❌ Nome, tipo e preço são obrigatórios.');
            return;
        }

        await client.query('BEGIN');

        const produtoInserido = await client.query(
            `INSERT INTO produtos (nome, tipo, preco, descricao)
             VALUES ($1, $2, $3, $4)
             RETURNING *`,
            [nome, tipo, preco, descricao]
        );

        const novoProduto = produtoInserido.rows[0];

        const estoqueInserido = await client.query(
            `INSERT INTO estoque (produto_id, quantidade)
             VALUES ($1, $2)
             RETURNING quantidade`,
            [novoProduto.id, estoque || 0]
        );

        await client.query('COMMIT');

        console.log('\n✅ Item cadastrado com sucesso!');
        console.log(`   ID gerado pelo banco: ${novoProduto.id}`);
        console.log(`   ${novoProduto.nome} adicionado à loja com estoque de ${estoqueInserido.rows[0].quantidade}.`);

        await registrarMovimentacao(
            client,
            usuarioLogado,
            'INSERT_PRODUTO',
            novoProduto.id,
            novoProduto.nome,
            `Produto cadastrado: tipo "${novoProduto.tipo}", preço R$ ${novoProduto.preco}, estoque inicial ${estoqueInserido.rows[0].quantidade}`
        );

    } catch (erro) {
        await client.query('ROLLBACK');
        console.log('❌ Erro ao cadastrar item (nada foi salvo):', erro.message);
    } finally {
        await client.end();
    }
}

// ──────────────────────────────────────────────
// UPDATE — Atualizar estoque (agora numa tabela separada, ligada por produto_id)
// ──────────────────────────────────────────────
async function atualizarEstoque(usuarioLogado) {
    const client = criarCliente();

    try {
        await client.connect();

        const lista = await client.query(
            `SELECT p.id, p.nome, e.quantidade
             FROM produtos p
             JOIN estoque e ON e.produto_id = p.id
             ORDER BY p.nome`
        );

        console.log('\n✏️  ATUALIZAR ESTOQUE\n');
        lista.rows.forEach(item => {
            console.log(`[${item.id}] ${item.nome} — Estoque atual: ${item.quantidade}`);
        });

        console.log('');
        const produtoId    = prompt('ID do produto: ');
        const novoEstoque  = prompt('Novo estoque: ');

        const resultado = await client.query(
            `UPDATE estoque
             SET quantidade = $1
             WHERE produto_id = $2
             RETURNING quantidade`,
            [novoEstoque, produtoId]
        );

        if (resultado.rows.length === 0) {
            console.log('❌ Produto não encontrado. Verifique o ID.');
            return;
        }

        const nomeProduto = await client.query(
            'SELECT nome FROM produtos WHERE id = $1',
            [produtoId]
        );

        console.log(`\n✅ Estoque atualizado!`);
        console.log(`   ${nomeProduto.rows[0].nome}: ${resultado.rows[0].quantidade} unidades`);

        await registrarMovimentacao(
            client,
            usuarioLogado,
            'UPDATE_ESTOQUE',
            produtoId,
            nomeProduto.rows[0].nome,
            `Estoque alterado para ${resultado.rows[0].quantidade} unidades`
        );

    } catch (erro) {
        console.log('❌ Erro ao atualizar estoque:', erro.message);
    } finally {
        await client.end();
    }
}

// ──────────────────────────────────────────────
// DELETE — Remover produto.
// Graças ao ON DELETE CASCADE na tabela estoque, apagar o produto
// já apaga a linha de estoque correspondente automaticamente.
// ──────────────────────────────────────────────
async function removerItem(usuarioLogado) {
    const client = criarCliente();

    try {
        await client.connect();

        const lista = await client.query(
            'SELECT id, nome, tipo FROM produtos ORDER BY nome'
        );

        console.log('\n🗑️  REMOVER ITEM\n');
        lista.rows.forEach(item => {
            console.log(`[${item.id}] ${item.nome} (${item.tipo})`);
        });

        console.log('');
        const id = prompt('ID do item a remover: ');

        const busca = await client.query(
            'SELECT nome FROM produtos WHERE id = $1',
            [id]
        );

        if (busca.rows.length === 0) {
            console.log('❌ Item não encontrado.');
            return;
        }

        const confirmacao = prompt(
            `⚠️  Remover "${busca.rows[0].nome}"? Isso não pode ser desfeito. (s/n): `
        );

        if (confirmacao.toLowerCase() !== 's') {
            console.log('Operação cancelada.');
            return;
        }

        // O DELETE em produtos já remove a linha correspondente em estoque
        // por causa do ON DELETE CASCADE.
        await client.query('DELETE FROM produtos WHERE id = $1', [id]);

        console.log(`\n✅ "${busca.rows[0].nome}" removido da loja.`);

        await registrarMovimentacao(
            client,
            usuarioLogado,
            'DELETE_PRODUTO',
            id,
            busca.rows[0].nome,
            'Produto (e seu estoque) removido da loja'
        );

    } catch (erro) {
        console.log('❌ Erro ao remover item:', erro.message);
    } finally {
        await client.end();
    }
}

// ──────────────────────────────────────────────
// SELECT — Ver histórico de movimentações (com paginação)
// ──────────────────────────────────────────────
async function listarMovimentacoes() {
    const client = criarCliente();

    try {
        await client.connect();

        console.log('\n📜 HISTÓRICO DE MOVIMENTAÇÕES\n');

        const porPaginaInput = prompt('Registros por página (Enter para 10): ').trim();
        const porPagina = parseInt(porPaginaInput) > 0 ? parseInt(porPaginaInput) : 10;

        let pagina = 1;
        let continuar = true;

        while (continuar) {
            const offset = (pagina - 1) * porPagina;

            const resultado = await client.query(
                `SELECT * FROM movimentacoes
                 ORDER BY data_hora DESC
                 LIMIT $1 OFFSET $2`,
                [porPagina, offset]
            );
            const totalResultado = await client.query('SELECT COUNT(*) FROM movimentacoes');
            const total = parseInt(totalResultado.rows[0].count);
            const totalPaginas = Math.max(1, Math.ceil(total / porPagina));

            console.log(`\n── Página ${pagina} de ${totalPaginas} ──\n`);

            if (resultado.rows.length === 0) {
                console.log('Nenhuma movimentação registrada ainda.');
            } else {
                resultado.rows.forEach(mov => {
                    const dataFormatada = new Date(mov.data_hora).toLocaleString('pt-BR');
                    console.log(`[${dataFormatada}] ${mov.usuario} — ${mov.acao}`);
                    if (mov.item_nome) console.log(`    Item: ${mov.item_nome} (id ${mov.item_id})`);
                    if (mov.detalhes)  console.log(`    ${mov.detalhes}`);
                    console.log('    ─────────────────────────────────────────');
                });
            }

            console.log(`\nTotal de registros: ${total}`);
            console.log('[N] Próxima página   [P] Página anterior   [S] Sair');
            const opcao = prompt('Opção: ').trim().toLowerCase();

            if (opcao === 'n') {
                if (pagina < totalPaginas) pagina++;
                else console.log('⚠️  Você já está na última página.');
            } else if (opcao === 'p') {
                if (pagina > 1) pagina--;
                else console.log('⚠️  Você já está na primeira página.');
            } else {
                continuar = false;
            }
        }

    } catch (erro) {
        console.log('❌ Erro ao listar movimentações:', erro.message);
    } finally {
        await client.end();
    }
}

// ──────────────────────────────────────────────
// Menu principal — muda de acordo com o perfil
// ──────────────────────────────────────────────
async function menu(usuarioLogado, perfil) {
    let rodando = true;

    // Operário: só cadastra (INSERT) e atualiza (UPDATE)
    // Admin: consulta, cadastra, atualiza, remove, cadastra usuário e vê histórico
    const ehAdmin = perfil === 'adm';

    while (rodando) {
        console.log('\n╔════════════════════════════════════════╗');
        console.log('║     ⚗️  LOJA DO ALQUIMISTA VALDRIS     ║');
        console.log(`║     Usuário: ${usuarioLogado.padEnd(15)} (${perfil})  ║`);
        console.log('╠════════════════════════════════════════╣');
        if (ehAdmin) {
            console.log('║  1 - Ver itens da loja (filtro/página)  ║');
        }
        console.log('║  2 - Cadastrar novo item               ║');
        console.log('║  3 - Atualizar estoque                 ║');
        if (ehAdmin) {
            console.log('║  4 - Remover item                      ║');
            console.log('║  5 - Cadastrar novo usuário             ║');
            console.log('║  6 - Ver histórico de movimentações     ║');
        }
        console.log('║  0 - Fechar a loja                     ║');
        console.log('╚════════════════════════════════════════╝');

        const opcao = prompt('\nEscolha uma opção: ');

        switch (opcao) {
            case '1':
                if (ehAdmin) {
                    await listarItens();
                } else {
                    console.log('❌ Acesso negado: apenas o administrador pode consultar.');
                }
                break;
            case '2':
                await cadastrarItem(usuarioLogado);
                break;
            case '3':
                await atualizarEstoque(usuarioLogado);
                break;
            case '4':
                if (ehAdmin) {
                    await removerItem(usuarioLogado);
                } else {
                    console.log('❌ Acesso negado: apenas o administrador pode remover itens.');
                }
                break;
            case '5':
                if (ehAdmin) {
                    await cadastrarUsuario(usuarioLogado);
                } else {
                    console.log('❌ Acesso negado: apenas o administrador pode cadastrar usuários.');
                }
                break;
            case '6':
                if (ehAdmin) {
                    await listarMovimentacoes();
                } else {
                    console.log('❌ Acesso negado: apenas o administrador pode ver o histórico.');
                }
                break;
            case '0':
                rodando = false;
                console.log('\n🧙 Até a próxima, aventureiro!\n');
                break;
            default:
                console.log('❌ Opção inválida. Tente novamente.');
        }
    }
}

// ──────────────────────────────────────────────
// Início do programa: pede login antes de tudo
// ──────────────────────────────────────────────
async function iniciar() {
    const usuario = await login();

    if (!usuario) {
        console.log('\nNão foi possível entrar. Encerrando o programa.\n');
        return;
    }

    await menu(usuario.login, usuario.perfil);
}

iniciar();
CREATE DATABASE alquimista_db;

CREATE TABLE itens (
    id         SERIAL PRIMARY KEY,
    nome       VARCHAR(100) NOT NULL,
    tipo       VARCHAR(50)  NOT NULL,
    preco      DECIMAL(10,2) NOT NULL,
    estoque    INTEGER DEFAULT 0,
    descricao  TEXT
);

INSERT INTO itens (nome, tipo, preco, estoque, descricao) VALUES
    ('Poção de Cura',        'Poção',      15.00, 50, 'Restaura 50 pontos de vida'),
    ('Poção de Mana',        'Poção',      20.00, 30, 'Restaura 40 pontos de mana'),
    ('Olho de Dragão',       'Ingrediente', 8.50, 15, 'Ingrediente raro para poções de força'),
    ('Pó de Fada',           'Ingrediente', 5.00, 40, 'Usado em encantamentos de levitação'),
    ('Elixir da Sabedoria',  'Elixir',     45.00, 10, 'Aumenta inteligência por 1 hora'),
    ('Cristal de Gelo',      'Ingrediente',12.00, 25, 'Necessário para poções de velocidade'),
    ('Poção de Invisibilidade','Poção',    35.00,  8, 'Torna invisível por 10');

SELECT * FROM itens;

CREATE TABLE usuarios_nv (
    id     SERIAL PRIMARY KEY,
    login  VARCHAR(50) UNIQUE NOT NULL,
    senha  VARCHAR(50) NOT NULL,
    perfil VARCHAR(20) NOT NULL CHECK (perfil IN ('adm', 'operario'))
);

INSERT INTO usuarios_nv (login, senha, perfil) VALUES
    ('admin',    'admin123', 'adm'),
    ('operario', 'oper123',  'operario');
 	
SELECT * FROM usuarios;

CREATE TABLE movimentacoes (
    id         SERIAL PRIMARY KEY,
    usuario    VARCHAR(50) NOT NULL,
    acao       VARCHAR(30) NOT NULL,   -- LOGIN, LOGIN_FALHA, INSERT_ITEM, UPDATE_ITEM, DELETE_ITEM, INSERT_USUARIO
    item_id    INTEGER,
    item_nome  VARCHAR(100),
    detalhes   TEXT,
    data_hora  TIMESTAMP NOT NULL DEFAULT NOW()
);
SELECT * FROM movimentacoes;
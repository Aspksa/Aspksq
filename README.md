# TRACKTOR — Comando & Segundo Cérebro

Recriação web interativa, baseada em uma gravação de tela de referência.

## ▶ Executar

Abra [index.html](./index.html) em um navegador moderno. Não é necessário instalar dependências, Node.js ou rodar um servidor de desenvolvimento.

## Recursos

- **Comando** — painel com carteira de clientes, equipe, relógio, avisos e mapa radial.
- **Segundo Cérebro** — mapa SVG interativo com layouts **Anéis**, **Círculo**, **Hex** e **Força**.
- Zoom com scroll, botões e teclado; arrastar para movimentar o mapa.
- Busca de arquivos, foco em departamentos/pastas, expansão/recolhimento de nós.
- Troca de temas de cores, ajuste de giro/tamanho/força, painel HUD.
- Salvar preferências no navegador (localStorage).
- Exportar o mapa atual para PNG.
- Visualização adaptativa para desktop e celular.

## Atalhos do mapa

| Tecla | Ação |
| --- | --- |
| `/` | Focar a busca |
| `+` ou `=` | Zoom in |
| `-` | Zoom out |
| `0` | Recentrar |
| `?` | Atalhos |
| `Escape` | Fechar detalhes / sair da apresentação |

## 🌐 Publicação no GitHub Pages

O repositório inclui [um workflow de deploy](.github/workflows/pages.yml) que publica o conteúdo na branch `main`.

1. Em **Settings → Pages**, escolha **Build and deployment → Source → GitHub Actions**.
2. Em **Actions**, acompanhe o workflow **Deploy TRACKTOR to GitHub Pages**.
3. A página ficará em **https://aspksa.github.io/Aspksq/** após um deploy bem-sucedido.

> A publicação depende de GitHub Pages e Actions estarem habilitados nas configurações do repositório.

## Estrutura

- `index.html`: páginas, painéis e controles.
- `styles.css`: tema escuro, painel e interface responsiva.
- `app.js`: visualização SVG, interações, persistência e exportação.

## Limitações da recriação

Os dados de contas, arquivos e agentes exibidos são **demonstrativos**. O vídeo de referência não contém a base de dados ou a lógica interna da aplicação original. Esta recriação reproduz a interface e as principais interações visíveis, mas não se conecta ao backend real.

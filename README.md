# 🚚 Checklist Logma

Aplicação interna para **checklist e abastecimento** de frota (focada em frota pesada), construída em **React (Vite)** e **Firebase** (Auth, Firestore e Storage).  
Inclui painel de KPIs, lançamento com imagem (nota/comprovante), histórico, cadastro de veículos e controle de acesso por papéis.

> **Status:** Uso interno (comercial/privado).

---

## ✨ Principais recursos

- 🔐 **Autenticação** (Firebase Auth) + controle por **papéis** (`useUserRoles`, `RoleGate`)
- 🚛 **Veículos** (seção e modal de gestão)
- ⛽ **Abastecimentos**
  - Lançamento com foto (armazenada no Storage)
  - Edição/Exclusão em modal
  - Exportação para Excel (SheetJS)
- 📊 **Dashboard de KPIs** (mês atual x anterior, metas de preço por frota)
- 👮 **Painel de Administrador**
  - Gráficos, pendências, administração de usuarios, checklists e veículos
- ⛽ Manutenções
- 🧾 **Histórico** (busca e filtros)
- 📝 **Checklist** (apenas frota pesada)
- 👮 **Rotas protegidas** (`ProtectedRoute`) e **gates** por role/permissão
- 🎯 **Targets** (metas de R$/L por frota) persistidos no Firestore

---

## 🗂️ Estrutura do projeto

src/
├─ assets/
│ └─ logo.png
├─ auth/
│ ├─ AuthContext.jsx
│ └─ ProtectedRoute.jsx
├─ components/
│ ├─ abastecimento/
│ │ ├─ DashboardAbastecimento.jsx
│ │ ├─ EditarAbastecimentoModal.jsx
│ │ ├─ LancarAbastecimento.jsx
│ │ └─ ModalLancarAbastecimento.jsx
│ ├─ Login.jsx
│ ├─ UsuariosSection.jsx
│ ├─ VeiculosSection.jsx
│ └─ VeiculosSectionModalContainer.jsx
├─ data/
│ └─ checklistItems.js
├─ hooks/
│ └─ useUserRoles.js
├─ modules/
│ └─ abastecimento/
│ ├─ MyAbastecimentos.jsx
│ └─ PublicAbastecimentoForm.jsx
├─ pages/
│ ├─ AdminPanel.jsx
│ ├─ Checklist.jsx
│ ├─ Historico.jsx
│ ├─ Home.jsx
│ └─ manutencao.jsx
├─ services/
│ ├─ abastecimentos.js
│ ├─ firebase.js
│ └─ veiculos.js
├─ App.jsx
├─ index.css
├─ main.jsx
└─ Themecontext.jsx

---

## 🔧 Tecnologias

- **React + Vite**
- **Firebase** (Auth, Firestore, Storage)
- **Bootstrap 5** + **React Icons**
- **SheetJS (xlsx)** para exportação
- **Chart.js / Recharts** em KPIs

---

## 🚀 Ambiente de desenvolvimento

### Pré-requisitos
- Node.js LTS (18+)
- npm (ou pnpm/yarn)
- Projeto Firebase criado (Auth + Firestore + Storage)
- Variáveis de ambiente configuradas

Checklist Logma — Copyright © Logma.

Este software é de **uso interno e confidencial**. Você não tem permissão para copiar, distribuir, sublicenciar, revender, publicar ou disponibilizar este software a terceiros, no todo ou em parte, sem autorização **expressa e por escrito** da Logma.

Direitos concedidos:
- Execução e uso interno pela equipe autorizada da Logma;
- Modificações internas para manutenção/evolução do produto.

Restrições:
- É proibida a redistribuição, uso fora do ambiente corporativo ou disponibilização pública;
- É proibida a engenharia reversa para fins de cópia/redistribuição;
- Quaisquer dados tratados pelo sistema devem ser protegidos conforme as políticas de segurança da Logma.

Este software é fornecido “no estado em que se encontra”, sem garantias de qualquer tipo. Em caso de dúvidas, contatar o time responsável.


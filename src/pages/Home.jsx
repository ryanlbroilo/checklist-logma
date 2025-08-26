import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FaTruck,
  FaCogs,
  FaBatteryFull,
  FaGasPump,
  FaHistory,
  FaWrench,
  FaUserShield,
  FaSignOutAlt,
  FaChevronDown,
} from "react-icons/fa";
import logo from "../assets/logo-branco.png";

const checklistPorRole = {
  motorista: {
    label: "Novo Checklist Veículo",
    rota: "/checklist/veiculo",
    icon: <FaTruck size={20} />,
  },
  operador_empilhadeira: {
    label: "Novo Checklist Equipamento",
    rota: "/checklist/equipamento",
    icon: <FaCogs size={20} />,
  },
  operador_gerador: {
    label: "Novo Checklist Gerador",
    rota: "/checklist/gerador",
    icon: <FaBatteryFull size={20} />,
  },
};

export default function Home({ motorista, onLogout, role, roles = [] }) {
  const navigate = useNavigate();
  const [openChecklistMenu, setOpenChecklistMenu] = useState(false);
  const menuRef = useRef(null);

  // --- Normalização de roles (compat string/array)
  const rolesArr = Array.isArray(roles) ? roles : (role ? [role] : []);
  const has = (r) => rolesArr.includes(r);
  const isAdmin = has("admin") || role === "admin";
  const isMotorista = has("motorista") || role === "motorista";
  const isVendedor = has("vendedor") || role === "vendedor";
  const isOpEmp = has("operador_empilhadeira") || role === "operador_empilhadeira";
  const isOpGer = has("operador_gerador") || role === "operador_gerador";

  // vendedor sem outros papéis
  const vendorOnly = isVendedor && !isAdmin && !isMotorista;

  // --- Checklist habilitado só seg/qui para não-admin
  const hoje = new Date();
  const diaSemana = hoje.getDay();
  const podeAcessarChecklist = diaSemana === 1 || diaSemana === 4;
  const checklistDesabilitado = !isAdmin && !podeAcessarChecklist;

  const handleChecklistClick = (rota) => {
    if (checklistDesabilitado) return;
    navigate(rota);
  };

  // --- Fecha submenu ao clicar fora
  useEffect(() => {
    function onDocClick(e) {
      if (!openChecklistMenu) return;
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setOpenChecklistMenu(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [openChecklistMenu]);

  // --- Role primária para botão simples (não-admin)
  const availableChecklistRoles = Object.keys(checklistPorRole);
  const primaryChecklistRole =
    rolesArr.find((r) => availableChecklistRoles.includes(r)) ||
    (availableChecklistRoles.includes(role) ? role : null);

  // --- Permissão para módulos públicos de abastecimento (APENAS admin/motorista/vendedor)
  const canAbastecerPublic = isAdmin || isMotorista || isVendedor;

  return (
    <div className="min-vh-100 d-flex flex-column justify-content-center align-items-center bg-dark text-white py-5">
      <div className="container" style={{ maxWidth: 960 }}>
        {/* logo */}
        <div className="text-center mb-4">
          <img
            src={logo}
            alt="Logma Transportes"
            style={{
              width: 180,
              height: 120,
              objectFit: "contain",
              filter: "drop-shadow(4px 4px 8px rgba(114,114,114,.6))",
            }}
          />
        </div>

        {/* título */}
        <div className="text-center mb-4">
          <h1 className="fw-bold m-0 home-title">
            Bem-vindo, <span className="text-white">{motorista}</span>
          </h1>
          <p className="text-white-50 mt-2 mb-0 small">
            Selecione uma ação para continuar
          </p>
        </div>

        {/* actions wrapper + grid */}
        <div className="home-actions">
          <div className="actions-grid">
            {/* ===== CHECKLIST (oculto para vendedor-only) ===== */}
            {!vendorOnly && (
              isAdmin ? (
                <div className="position-relative" ref={menuRef}>
                  <button
                    className="btn btn-tile btn-secondary d-flex align-items-center justify-content-center"
                    type="button"
                    onClick={() => setOpenChecklistMenu((s) => !s)}
                    aria-expanded={openChecklistMenu}
                    aria-controls="checklist-submenu"
                  >
                    <FaTruck className="me-2" />
                    Checklists
                    <FaChevronDown className="ms-2" />
                  </button>

                  {/* submenu */}
                  {openChecklistMenu && (
                    <div
                      id="checklist-submenu"
                      className="submenu-panel fade-in-up"
                      role="menu"
                    >
                      <button
                        className="submenu-item"
                        onClick={() => {
                          setOpenChecklistMenu(false);
                          navigate("/checklist/veiculo");
                        }}
                        type="button"
                        role="menuitem"
                      >
                        <FaTruck className="me-2" /> Checklist Veículo
                      </button>
                      <button
                        className="submenu-item"
                        onClick={() => {
                          setOpenChecklistMenu(false);
                          navigate("/checklist/equipamento");
                        }}
                        type="button"
                        role="menuitem"
                      >
                        <FaCogs className="me-2" /> Checklist Equipamento
                      </button>
                      <button
                        className="submenu-item"
                        onClick={() => {
                          setOpenChecklistMenu(false);
                          navigate("/checklist/gerador");
                        }}
                        type="button"
                        role="menuitem"
                      >
                        <FaBatteryFull className="me-2" /> Checklist Gerador
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                primaryChecklistRole &&
                checklistPorRole[primaryChecklistRole] && (
                  <button
                    className={`btn btn-tile btn-secondary ${
                      checklistDesabilitado ? "disabled opacity-75" : ""
                    }`}
                    onClick={() =>
                      handleChecklistClick(
                        checklistPorRole[primaryChecklistRole].rota
                      )
                    }
                    disabled={checklistDesabilitado}
                    aria-disabled={checklistDesabilitado}
                    title={
                      checklistDesabilitado
                        ? "Disponível apenas nas segundas e quintas-feiras"
                        : ""
                    }
                    type="button"
                  >
                    {checklistPorRole[primaryChecklistRole].icon}{" "}
                    {checklistPorRole[primaryChecklistRole].label}
                  </button>
                )
              )
            )}

            {/* ===== HISTÓRICO CHECKLIST (oculto para vendedor-only) ===== */}
            {!vendorOnly && (
              <button
                className="btn btn-tile btn-historico"
                onClick={() => navigate("/historico")}
                type="button"
              >
                <FaHistory className="me-2" />
                Meu Histórico de Checklists
              </button>
            )}

            {/* ====== ABASTECIMENTO PÚBLICO (somente admin/motorista/vendedor) ====== */}
            {canAbastecerPublic && (
              <>
                <button
                  className="btn btn-tile btn-secondary"
                  onClick={() => navigate("/abastecimento/lancar")}
                  type="button"
                >
                  <FaGasPump className="me-2" />
                  Lançar Abastecimento
                </button>

                <button
                  className="btn btn-tile btn-historico"
                  onClick={() => navigate("/meus-abastecimentos")}
                  type="button"
                >
                  <FaHistory className="me-2" />
                  Meu Histórico de Abastecimentos
                </button>
              </>
            )}

            {/* ====== MÓDULOS ADMIN ====== */}
            {isAdmin && (
              <button
                className="btn btn-tile btn-abastecimento"
                onClick={() => navigate("/abastecimento")}
                type="button"
              >
                <FaGasPump className="me-2" />
                Abastecimento
              </button>
            )}

            {isAdmin && (
              <>
                <button
                  className="btn btn-tile btn-manutencao"
                  onClick={() => navigate("/manutencao")}
                  type="button"
                >
                  <FaWrench className="me-2" />
                  Manutenções
                </button>

                <button
                  className="btn btn-tile btn-admin"
                  onClick={() => navigate("/admin")}
                  type="button"
                >
                  <FaUserShield className="me-2" />
                  Painel Admin
                </button>
              </>
            )}

            {/* SAIR (todos) */}
            <button
              className="btn btn-tile btn-sair"
              onClick={onLogout}
              type="button"
            >
              <FaSignOutAlt className="me-2" />
              Sair
            </button>
          </div>
        </div>

        {/* aviso não-admin fora de seg/qui (só mostra se houver checklist) */}
        {!vendorOnly && !podeAcessarChecklist && !isAdmin && (
          <p className="text-warning mt-3 text-center small">
            Você só pode acessar os checklists nas segundas e quintas-feiras.
          </p>
        )}

        {/* rodapé */}
        <footer className="mt-5 pt-4 border-top border-secondary text-center">
          <small className="d-block text-white-50">
            Criado por <strong>Ryan L Broilo</strong> • Logma Transportes • 2025
          </small>
        </footer>
      </div>
    </div>
  );
}

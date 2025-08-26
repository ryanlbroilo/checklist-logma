import VeiculosSection from "../VeiculosSection";

export default function VeiculosSectionModalContainer({
  open,
  onClose,
  defaultTipoFrota = "",
}) {
  if (!open) return null;

  return (
    <div className="modal d-block" tabIndex="-1" style={{ background: "rgba(0,0,0,.55)" }}>
      <div className="modal-dialog modal-xl modal-dialog-centered">
        <div className="modal-content">
          <div className="modal-header border-0">
            <h5 className="modal-title fw-bold">Gerenciar Veículos</h5>
            <button type="button" className="btn-close" onClick={onClose} />
          </div>
          <div className="modal-body">
            <VeiculosSection
              defaultTipoFrota={defaultTipoFrota}
              onAfterChange={() => onClose?.()}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

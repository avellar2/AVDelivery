export const SUBSCRIPTION_EVENT_LABELS: Record<string, string> = {
  store_created: "Estabelecimento criado",
  store_updated: "Dados administrativos atualizados",
  subscription_created: "Assinatura criada",
  grandfathered: "Isenção de loja preexistente",
  owner_assigned: "Proprietário vinculado",
  admin_start_trial: "Teste iniciado",
  admin_activate: "Assinatura ativada",
  admin_reactivate: "Assinatura reativada",
  admin_grant_grace: "Carência concedida",
  admin_expire: "Acesso expirado",
  admin_cancel: "Assinatura cancelada",
  admin_set_exempt: "Isenção administrativa concedida",
  admin_remove_exempt: "Isenção administrativa removida",
  admin_change_plan: "Plano alterado",
  billing_profile_updated: "Dados de faturamento atualizados",
  payment_confirmed: "Pagamento confirmado",
  payment_overdue: "Cobrança vencida",
  payment_refunded: "Pagamento estornado",
  payment_chargeback: "Chargeback recebido",
};

export const INVOICE_STATUS_LABELS: Record<string, string> = {
  pending: "Pendente",
  paid: "Paga",
  overdue: "Em atraso",
  canceled: "Cancelada",
  refunded: "Estornada",
  chargeback: "Chargeback",
};

export const BILLING_TYPE_LABELS: Record<string, string> = {
  PIX: "Pix",
  BOLETO: "Boleto",
  CREDIT_CARD: "Cartão",
  UNDEFINED: "A definir",
};

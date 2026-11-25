/* States and union territories, for "place of supply" (CGST + SGST inside the company's state, IGST outside it). */
export const INDIA_STATES = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir',
  'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya',
  'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
];

/** GST state codes (the first two digits of a GSTIN). */
export const GST_STATE_CODE = {
  'Jammu and Kashmir': '01', 'Himachal Pradesh': '02', Punjab: '03', Chandigarh: '04', Uttarakhand: '05', Haryana: '06', Delhi: '07',
  Rajasthan: '08', 'Uttar Pradesh': '09', Bihar: '10', Sikkim: '11', 'Arunachal Pradesh': '12', Nagaland: '13', Manipur: '14',
  Mizoram: '15', Tripura: '16', Meghalaya: '17', Assam: '18', 'West Bengal': '19', Jharkhand: '20', Odisha: '21', Chhattisgarh: '22',
  'Madhya Pradesh': '23', Gujarat: '24', 'Dadra and Nagar Haveli and Daman and Diu': '26', Maharashtra: '27', Karnataka: '29', Goa: '30',
  Lakshadweep: '31', Kerala: '32', 'Tamil Nadu': '33', Puducherry: '34', 'Andaman and Nicobar Islands': '35', Telangana: '36',
  'Andhra Pradesh': '37', Ladakh: '38',
};

/** Same rule as the server (gst_state.is_inter_state): GSTIN state codes when both are known, else the state names. */
export function isInterState(companyState, companyGstin, customerState, customerGstin) {
  const code = (g) => (/^\d{2}/.test(g || '') ? g.slice(0, 2) : null);
  const a = code(companyGstin) || GST_STATE_CODE[companyState] || null;
  const b = code(customerGstin) || GST_STATE_CODE[customerState] || null;
  if (a && b) return a !== b;
  const n = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  return n(customerState) !== n(companyState);
}

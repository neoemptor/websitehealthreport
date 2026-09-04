/**
 * The operator's business identity, as it appears on client-facing output.
 *
 * One definition, because these values appear in two places that are rendered
 * by different engines: the report route in the renderer, and the PDF page
 * footer, which Chromium renders from an HTML string in the main process. A
 * second copy would drift, and a wrong phone number on a client's document is
 * not a typo anyone catches by reading the code.
 *
 * PRODUCT.md records these as confirmed brand commitments. The name is used
 * verbatim and is never abbreviated.
 */
export const BUSINESS = {
	name: 'D S Bailey Freelancer',
	email: 'admin@dsbaileyfreelancer.com.au',
	/** Dial-safe, for tel: links. */
	phone: '+61430227786',
	/** Grouped the way an Australian mobile is read aloud. */
	phoneDisplay: '+61 430 227 786',
	website: 'https://dsbaileyfreelancer.com.au',
	/** Without the scheme: shorter to read, and nobody types "https://". */
	websiteDisplay: 'dsbaileyfreelancer.com.au'
} as const;

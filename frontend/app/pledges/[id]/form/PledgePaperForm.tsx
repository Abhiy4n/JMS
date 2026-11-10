import type { Pledge } from "@/lib/pledge-data";
import { toNepaliCurrencyWords } from "@/lib/nepali-currency-words.js";
import type { ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import styles from "./pledge-paper-form.module.css";

type PaperPledge = Pick<
  Pledge,
  "written_text" | "customer_name" | "address" | "phone" | "principal_amount" |
  "pledge_date" | "due_date" | "items"
>;
type PaperControls = {
  writtenText: ReactNode;
  customerName: ReactNode;
  address: ReactNode;
  phone: ReactNode;
  principalAmount: ReactNode;
  pledgeDate: ReactNode;
  dueDate: ReactNode;
  itemParticulars: (index: number) => ReactNode;
  itemWeight: (index: number) => ReactNode;
  itemUnit: (index: number) => ReactNode;
  itemGhat: (index: number) => ReactNode;
  itemJor: (index: number) => ReactNode;
  addItem: () => void;
  removeItem: (index: number) => void;
  itemActionsDisabled: boolean;
};
type PaperFormProps = { pledge: PaperPledge } & (
  | { mode?: "view"; controls?: never }
  | { mode: "create" | "edit"; controls: PaperControls }
);

function Blank({ label }: { label: string }) {
  return (
    <span className={styles.blank}>
      <span className={styles.screenReaderOnly}>{label}: खाली</span>
      {"\u00a0"}
    </span>
  );
}

function FieldValue({ label, value }: { label: string; value: string }) {
  return value ? <span className={styles.value}>{value}</span> : <Blank label={label} />;
}

const UNIT_LABELS = {
  TOLA: "तोला",
  LAAL: "लाल",
  GRAM: "ग्राम",
} as const;

export default function PledgePaperForm({ pledge, mode = "view", controls }: PaperFormProps) {
  const amountWords = toNepaliCurrencyWords(pledge.principal_amount);
  return (
    <div className={styles.viewport} role="region" aria-label="भाखा पत्र" tabIndex={0}>
      <article className={styles.sheet} lang="ne" data-mode={mode} aria-labelledby="nepali-pledge-form-title">
        <h2 id="nepali-pledge-form-title" className={styles.title}>भाखा पत्र</h2>

        <div className={styles.writtenField}>
          <span>लिखितम् :</span>
          {controls ? controls.writtenText : <FieldValue label="लिखितम्" value={pledge.written_text} />}
        </div>
        <div className={styles.partyGrid}>
          <div className={`${styles.field} ${styles.address}`}>
            <span>जिल्ला</span>
            {controls ? controls.address : <FieldValue label="जिल्ला" value={pledge.address} />}
          </div>
          <div className={styles.field}>
            <span>बस्ने</span>
            {controls ? controls.customerName : <FieldValue label="बस्ने" value={pledge.customer_name} />}
          </div>
        </div>

        <div className={styles.reservedText} aria-hidden="true" />

        <div className={styles.sectionHeading}>
          <h3>तपसिल</h3>
        </div>

        <div className={styles.terms}>
          <div className={styles.amount}>
            <div className={styles.field}>
              <span>लिएको रकम रु.</span>
              {controls ? controls.principalAmount : <FieldValue label="लिएको रकम" value={pledge.principal_amount} />}
            </div>
            <div className={styles.field}>
              <span>अङ्कमा</span>
              <output className={styles.amountWords} aria-live={controls ? "polite" : undefined}>
                {amountWords || <Blank label="रकम अक्षरमा" />}
              </output>
            </div>
          </div>
          <div className={styles.dates}>
            <div className={styles.field}>
              <span>राखेको मिति</span>
              {controls ? controls.pledgeDate : <FieldValue label="राखेको मिति" value={pledge.pledge_date} />}
            </div>
            <div className={styles.field}>
              <span>सावा ब्याज बुझाउने भाका</span>
              {controls
                ? controls.dueDate
                : pledge.due_date
                  ? <span className={styles.value}>{pledge.due_date}</span>
                  : <Blank label="सावा ब्याज बुझाउने भाका" />}
            </div>
          </div>
        </div>

        {controls && (
          <div className={styles.itemToolbar}>
            <span className={styles.itemHeading}>
              <span>दिएको राखेको विवरण</span>
              <span className={styles.itemCount} aria-live="polite">{pledge.items.length} विवरण</span>
            </span>
            <button className={styles.addItem} type="button" onClick={controls.addItem} disabled={controls.itemActionsDisabled}>
              <Plus size={16} aria-hidden="true" />विवरण थप्नुहोस्
            </button>
          </div>
        )}
        <table className={styles.items}>
          <caption className={styles.screenReaderOnly}>दिएको राखेको विवरण</caption>
          <colgroup>
            <col className={styles.sequenceColumn} /><col className={styles.descriptionColumn} />
            <col className={styles.weightColumn} /><col className={styles.ghatColumn} />
            <col className={styles.jorColumn} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">क्र.सं.</th>
              <th scope="col">दिएको राखेको विवरण</th>
              <th scope="col">तोल</th>
              <th scope="col">थान</th>
              <th scope="col">जोर</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className={styles.entryList} rowSpan={pledge.items.length + 1}>
                {pledge.items.map((item, index) => (
                  <div className={styles.entry} key={`sequence-${item.id}`}>
                    {controls ? (
                      <div className={styles.rowControls}>
                        <span>{index + 1}</span>
                        <button
                          className={styles.removeItem}
                          type="button"
                          aria-label={`विवरण ${index + 1} हटाउनुहोस्`}
                          title={pledge.items.length === 1 ? "कम्तीमा एउटा विवरण आवश्यक छ" : `विवरण ${index + 1} हटाउनुहोस्`}
                          disabled={controls.itemActionsDisabled || pledge.items.length === 1}
                          onClick={() => controls.removeItem(index)}
                        ><Trash2 size={16} aria-hidden="true" /></button>
                      </div>
                    ) : index + 1}
                  </div>
                ))}
              </td>
              <td className={`${styles.entryList} ${styles.description}`} rowSpan={pledge.items.length + 1}>
                {pledge.items.map((item, index) => (
                  <div className={styles.entry} key={`particulars-${item.id}`}>
                    {controls ? controls.itemParticulars(index) : item.particulars}
                  </div>
                ))}
              </td>
              <td className={styles.entryList} rowSpan={pledge.items.length + 1}>
                {pledge.items.map((item, index) => (
                  <div className={styles.entry} key={`weight-${item.id}`}>
                    {controls ? (
                      <div className={styles.unitGroup}>{controls.itemWeight(index)}{controls.itemUnit(index)}</div>
                    ) : `${item.weight} ${UNIT_LABELS[item.unit]}`}
                  </div>
                ))}
              </td>
              <td>{controls ? controls.itemGhat(0) : <FieldValue label="थान" value={pledge.items[0]?.ghat ?? ""} />}</td>
              <td>{controls ? controls.itemJor(0) : pledge.items[0]?.jor}</td>
            </tr>
            {pledge.items.slice(1).map((item, offset) => {
              const index = offset + 1;
              return (
                <tr key={item.id}>
                  <td>{controls ? controls.itemGhat(index) : <FieldValue label="थान" value={item.ghat} />}</td>
                  <td>{controls ? controls.itemJor(index) : item.jor}</td>
                </tr>
              );
            })}
            <tr className={styles.printedRow}>
              <td>दर</td>
              <td>बा</td>
            </tr>
            <tr className={styles.footerRow}>
              <td colSpan={3}>
                <div className={styles.footerPhone}>
                  <span>फोन नं. :</span>
                  {controls ? controls.phone : <FieldValue label="फोन नं." value={pledge.phone} />}
                </div>
              </td>
              <td colSpan={2}><span>सही :</span></td>
            </tr>
          </tbody>
        </table>
      </article>
    </div>
  );
}

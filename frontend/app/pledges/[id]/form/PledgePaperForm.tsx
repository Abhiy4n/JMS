import type { Pledge } from "@/lib/pledge-data";
import type { ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import styles from "./pledge-paper-form.module.css";

type PaperPledge = Pick<Pledge, "customer_name" | "pledge_date" | "amount_received" | "due_date" | "items">;
type PaperControls = {
  customer: ReactNode;
  amountReceived: ReactNode;
  pledgeDate: ReactNode;
  dueDate: ReactNode;
  itemDescription: (index: number) => ReactNode;
  itemWeight: (index: number) => ReactNode;
  itemQuantity: (index: number) => ReactNode;
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
      <span className={styles.screenReaderOnly}>{label}: कागजमा भर्न खाली ठाउँ</span>
      {"\u00a0"}
    </span>
  );
}

export default function PledgePaperForm({ pledge, mode = "view", controls }: PaperFormProps) {
  return (
    <div className={styles.viewport} role="region" aria-label="Nepali Pledge form; scroll horizontally if needed" tabIndex={0}>
      <article className={styles.sheet} lang="ne" data-mode={mode} aria-labelledby="nepali-pledge-form-title">
        <h2 id="nepali-pledge-form-title" className={styles.title}>भाखा पत्र</h2>

        <div className={styles.partyGrid}>
          <div className={styles.field}><span>जिल्ला</span><Blank label="जिल्ला" /></div>
          <div className={styles.field}>
            <span>कारोबारी</span>
            {controls ? <div className={styles.control}>{controls.customer}</div> : pledge.customer_name ? <span className={styles.value}>{pledge.customer_name}</span> : <Blank label="कारोबारी" />}
          </div>
          <div className={`${styles.field} ${styles.address}`}><span>ठेगाना</span><Blank label="ठेगाना" /></div>
        </div>

        {/* Reserve the paper's declaration area without inventing its unclear wording. */}
        <div className={styles.reservedText} aria-hidden="true" />

        <div className={styles.sectionHeading}>
          <h3>तपसिल</h3>
          {/* The API has a JMS identifier, but no separate paper serial number. */}
          <div className={styles.paperSerial}>
            <span className={styles.screenReaderOnly}>कागजी क्रमाङ्कको लागि खाली ठाउँ</span>
          </div>
        </div>

        <div className={styles.terms}>
          <div className={styles.amount}>
            <div>लिएको रकम</div>
            <div className={styles.field}><span>रु.</span>{controls ? <div className={styles.control}>{controls.amountReceived}</div> : <span className={styles.value}>{pledge.amount_received}</span>}</div>
          </div>
          <div className={styles.dates}>
            <div className={styles.field}><span>मिति :</span>{controls ? <div className={styles.control}>{controls.pledgeDate}</div> : <span className={styles.value}>{pledge.pledge_date}</span>}</div>
            <div className={styles.field}>
              <span>भाका</span>
              {controls ? <div className={styles.control}>{controls.dueDate}</div> : pledge.due_date ? <span className={styles.value}>{pledge.due_date}</span> : <Blank label="भाका" />}
            </div>
          </div>
        </div>

        {controls && (
          <div className={styles.itemToolbar}>
            <span className={styles.itemHeading}>
              <span>दिएको र लिएको विवरण</span>
              <span className={styles.itemCount} lang="en" aria-live="polite">{pledge.items.length} {pledge.items.length === 1 ? "item" : "items"}</span>
            </span>
            <button className={styles.addItem} type="button" lang="en" onClick={controls.addItem} disabled={controls.itemActionsDisabled}>
              <Plus size={16} aria-hidden="true" />Add Item
            </button>
          </div>
        )}
        <table className={styles.items}>
          <caption className={styles.screenReaderOnly}>दिएको र लिएको विवरण; तोल ग्राममा; घट र जोर कागजमा भर्न खाली ठाउँ</caption>
          <colgroup>
            <col className={styles.sequenceColumn} /><col className={styles.descriptionColumn} />
            <col className={styles.weightColumn} /><col className={styles.manualColumn} /><col className={styles.manualColumn} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">क्र.सं.</th><th scope="col">दिएको र लिएको विवरण</th>
              <th scope="col" aria-label="तोल (ग्राम)">तोल</th><th scope="col">घट</th><th scope="col">जोर</th>
            </tr>
          </thead>
          <tbody>
            {pledge.items.map((item, index) => (
              <tr key={item.id}>
                <td>
                  {controls ? (
                    <div className={styles.rowControls}>
                      <span>{index + 1}</span>
                      <button
                        className={styles.removeItem}
                        type="button"
                        lang="en"
                        aria-label={`Remove item ${index + 1}`}
                        title={pledge.items.length === 1 ? "At least one item is required" : `Remove item ${index + 1}`}
                        disabled={controls.itemActionsDisabled || pledge.items.length === 1}
                        onClick={() => controls.removeItem(index)}
                      ><Trash2 size={16} aria-hidden="true" /></button>
                    </div>
                  ) : index + 1}
                </td>
                <td className={styles.description}>
                  {controls ? controls.itemDescription(index) : item.description}
                  <div className={styles.quantity} lang="en">
                    <span>Quantity:</span>
                    {controls ? <div>{controls.itemQuantity(index)}</div> : <span>{item.quantity}</span>}
                  </div>
                </td>
                <td>{controls ? controls.itemWeight(index) : item.weight_grams}</td>
                <td><span className={styles.screenReaderOnly}>घट: कागजमा भर्न खाली ठाउँ</span></td>
                <td><span className={styles.screenReaderOnly}>जोर: कागजमा भर्न खाली ठाउँ</span></td>
              </tr>
            ))}
            {/* The positions of वा and न need the original photo; do not guess. */}
          </tbody>
        </table>

        <div className={styles.footer}>
          <div className={styles.field}><span>खाता नं.</span><Blank label="खाता नं." /></div>
          <div className={styles.field}><span>सही</span><Blank label="सही" /></div>
        </div>
      </article>
    </div>
  );
}

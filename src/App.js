import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from './firebaseConfig';
import { 
  collection, 
  doc, 
  setDoc,
  getDoc, 
  onSnapshot,
  updateDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp 
} from 'firebase/firestore';
import React, { useState, useEffect, useMemo } from 'react';
import { Calendar, Users, TrendingUp, Map as MapIcon, Inbox, ChevronRight, Phone, DollarSign, Clock, Home, Plus, Layers } from 'lucide-react';
import { Chart as ChartJS, registerables } from 'chart.js';
import { Line } from 'react-chartjs-2'; 
import './App.css';
import { 
  Pencil, Trash2, RefreshCw, List, Edit2, ChevronDown, 
} from 'lucide-react';
import { CheckCircle, AlertCircle } from 'lucide-react';
import { X as CloseIcon } from 'lucide-react';

ChartJS.register(...registerables);


// Helper functions
export const formatCurrency = (value) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value);
};

const jobIdFor = (seriesId, scheduledDate) => `J-${seriesId}-${scheduledDate}`;

const createRecurringJobInstance = async (baseJob, nextDate, customers) => {
  const customerNumber = parseInt(baseJob.customerId.split('-')[1]);
  const customer = customers.find(c => c.customerId === baseJob.customerId);

  const nextJobId = jobIdFor(baseJob.seriesId, nextDate);
  const nextRoutingId = `${nextDate}-${customerNumber}-${nextJobId}`;

  const jobRef = doc(db, 'jobs', nextJobId);
  const existing = await getDoc(jobRef);
  if (existing.exists()) return;
  if (baseJob?.seriesStatus === 'paused' || baseJob?.isPaused) return;


  // ✅ reuse normalized rate from baseJob
  const finalRate = baseJob.bidType === 'hourly'
    ? (baseJob.hourlyRate || 0) * (baseJob.manHours || 0)
    : (baseJob.rate || baseJob.estimatedRate || 0);

  await setDoc(jobRef, {
    ...baseJob,
    jobId: nextJobId,
    scheduledDate: nextDate,
    rate: finalRate,
    estimatedRate: finalRate,
    status: 'Scheduled',
    createdAt: new Date().toISOString()
  });

  await setDoc(doc(db, 'routing', nextRoutingId), {
    id: nextRoutingId,
    jobId: nextJobId,
    date: nextDate,
    customerNumber,
    customerNameFirst: customer?.firstName || '',
    customerNameLast: customer?.lastName || '',
    serviceAddress: baseJob.serviceAddress,
    jobType: baseJob.serviceType,
    revenue: finalRate,
    estimatedRevenue: finalRate,
    manHours: baseJob.manHours || 0,
    bidType: baseJob.bidType,
    dollarsPerManHour: baseJob.manHours > 0 ? finalRate / baseJob.manHours : 0,
    invoiceSent: 'No',
    createdAt: new Date().toISOString()
  });
};


// add this function to automatically maintain 4 future jobs per series:
// Safe + idempotent: keeps at most N future scheduled jobs per series
const maintainRecurringJobs = async (baseJob, jobs, customers, getNextServiceDate) => {
  if (!baseJob?.isRecurring) return;
  if (baseJob?.seriesStatus === 'paused' || baseJob?.isPaused) return;


  // target number of FUTURE scheduled jobs to maintain
  const targetCount = baseJob.serviceFrequency === 'Bi-Weekly' ? 4 : 4;

  // work off live state
  const seriesJobs = jobs
    .filter(j => j.seriesId === baseJob.seriesId)
    .sort((a, b) => new Date(a.scheduledDate) - new Date(b.scheduledDate));

  if (seriesJobs.length === 0) return;

  // count FUTURE scheduled jobs (strictly after "today" job) and build a date set to avoid dupes
  const existingDates = new Set(seriesJobs.map(j => j.scheduledDate));
  let scheduledFutureCount = seriesJobs.filter(j => j.status === 'Scheduled' && new Date(j.scheduledDate) > new Date()).length;

  // start from the last known date in the series
  let lastDate = new Date(seriesJobs[seriesJobs.length - 1].scheduledDate);

  // hard safety to avoid runaway if something goes wrong
  let safety = 24;

  while (scheduledFutureCount < targetCount && safety-- > 0) {
    const nextDate = getNextServiceDate(lastDate.toISOString().split('T')[0], baseJob.serviceFrequency);
    if (!nextDate) break;

    // idempotency: skip if a job on this date already exists for the series
    if (!existingDates.has(nextDate)) {
      await createRecurringJobInstance(baseJob, nextDate, customers);
      existingDates.add(nextDate);
      scheduledFutureCount += 1;
    }

    lastDate = new Date(nextDate);
  }
};


// Modal Components
const JobCreationModal = ({ isOpen, onClose, lead, onConfirm }) => {
  const [jobData, setJobData] = useState({
  serviceType: 'Mowing',
  bidType: 'bid',
  estimatedRate: 0, // just use default values
  actualRate: null,
  hourlyRate: 75, // or whatever your default should be
  estimatedHours: '1',
  propertySqft: '',
  scheduledDate: new Date().toISOString().split('T')[0],
  serviceFrequency: 'Weekly',
  serviceAddress: '',
  notes: ''
});

  const currentRate = useMemo(() => {
    const rateAsNumber = parseFloat(jobData.rate);
    const hourlyRateAsNumber = parseFloat(jobData.hourlyRate);
    const estimatedHoursAsNumber = parseFloat(jobData.estimatedHours);
    if (jobData.bidType === 'hourly') {
      return hourlyRateAsNumber * estimatedHoursAsNumber;
    }
    return rateAsNumber;
  }, [jobData.bidType, jobData.rate, jobData.hourlyRate, jobData.estimatedHours]);

  const sqftPerDollar = useMemo(() => {
    const propertySqftAsNumber = parseFloat(jobData.propertySqft);
    if (propertySqftAsNumber > 0 && currentRate > 0) {
      return (propertySqftAsNumber / currentRate).toFixed(2);
    }
    return '0.00';
  }, [jobData.propertySqft, currentRate]);

  useEffect(() => {
    if (isOpen && lead?.address && lead.address !== jobData.serviceAddress) {
      setJobData(prev => ({ ...prev, serviceAddress: lead.address }));
    }
  }, [lead, isOpen, jobData.serviceAddress]);

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    const rateAsNumber = parseFloat(jobData.rate);
    const hourlyRateAsNumber = parseFloat(jobData.hourlyRate);
    const estimatedHoursAsNumber = parseFloat(jobData.estimatedHours);
    const finalRate = jobData.bidType === 'hourly'
      ? hourlyRateAsNumber * estimatedHoursAsNumber
      : rateAsNumber;
    const manHours = jobData.bidType === 'hourly' ? estimatedHoursAsNumber : 0;
    onConfirm({ 
  ...jobData, 
  estimatedRate: finalRate,
  hourlyRate: jobData.bidType === 'hourly' ? parseFloat(jobData.hourlyRate) : null,
  manHours: manHours 
});
    setJobData({ serviceType: 'Mowing', bidType: 'bid', rate: '', hourlyRate: '75', estimatedHours: '1', propertySqft: '', scheduledDate: new Date().toISOString().split('T')[0], serviceFrequency: 'Weekly', serviceAddress: '', notes: '' });
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content job-creation">
        <div className="modal-header">
          <h3>{lead?.firstName} {lead?.lastName}</h3>
        </div>
        <form onSubmit={handleSubmit} className="modal-form">
          <div>
            <label className="form-label">service address</label>
            <input type="text" value={jobData.serviceAddress} onChange={(e) => setJobData({ ...jobData, serviceAddress: e.target.value })} className="form-input" placeholder="123 main st, eagle river" required />
          </div>
          <div className="form-grid">
            <div>
              <label className="form-label">service type</label>
              <select value={jobData.serviceType} onChange={(e) => setJobData({ ...jobData, serviceType: e.target.value })} className="form-select">
                <option value="First Time Mowing">First time Mowing</option>
                <option value="Bag Haul">Bag Haul</option>
                <option value="Mowing">Mowing</option>
                <option value="Spring Cleanup">Spring cleanup</option>
                <option value="Spring Fertilizer">Spring Fertilizer</option>
                <option value="Spring Lime">Spring Lime</option>
                <option value="Summer Fertilizer">Summer Fertilizer</option>
                <option value="Fall Fertilizer">Spring Fertilizer</option>
                <option value="Fall Lime">Spring Lime</option>
                <option value="Leaf Removal">Leaf removal</option>
                <option value="Snow Removal">Snow removal</option>
                <option value="Misc">Miscellaneous</option>
              </select>
            </div>
            <div>
              <label className="form-label">Scheduled Date</label>
              <input type="date" value={jobData.scheduledDate} onChange={(e) => setJobData({ ...jobData, scheduledDate: e.target.value })} className="form-input" required />
            </div>
            <div>
              <label className="form-label">Pricing Type</label>
              <select value={jobData.bidType} onChange={(e) => setJobData({ ...jobData, bidType: e.target.value })} className="form-select">
                <option value="bid">Bid</option>
                <option value="hourly">Hourly</option>
              </select>
            </div>
            {jobData.bidType === 'bid' ? (
              <div>
                <label className="form-label">Bid Amount ($)</label>
                <input type="number" step="0.01" value={jobData.rate} onChange={(e) => setJobData({ ...jobData, rate: e.target.value })} className="form-input" placeholder="75.00" required />
              </div>
            ) : (
              <>
                <div>
                  <label className="form-label">Hourly Rate ($)</label>
                  <input type="number" step="0.01" value={jobData.hourlyRate} onChange={(e) => setJobData({ ...jobData, hourlyRate: e.target.value })} className="form-input" required />
                </div>
                <div>
                  <label className="form-label">Estimated Hours</label>
                  <input type="number" step="0.5" value={jobData.estimatedHours} onChange={(e) => setJobData({ ...jobData, estimatedHours: e.target.value })} className="form-input" required />
                </div>
                <div>
                  <label className="form-label">Total ($)</label>
                  <div className="form-display-field">{formatCurrency(currentRate)}</div>
                </div>
              </>
            )}
            <div>
              <label className="form-label">Property sqft</label>
              <input type="number" value={jobData.propertySqft} onChange={(e) => setJobData({ ...jobData, propertySqft: e.target.value })} className="form-input" placeholder="5000" />
            </div>
            <div>
              <label className="form-label">Service Frequency</label>
              <select value={jobData.serviceFrequency} onChange={(e) => setJobData({ ...jobData, serviceFrequency: e.target.value })} className="form-select">
                <option value="Weekly">Weekly</option>
                <option value="Bi-Weekly">Bi-weekly</option>
                <option value="Monthly">Monthly</option>
                <option value="One-Time">One-time</option>
                <option value="As-Needed">As-needed</option>
              </select>
            </div>
            <div>
              <label className="form-label">sqft/dollar</label>
              <div className="form-display-field">{sqftPerDollar}</div>
            </div>
          </div>
          <div>
            <label className="form-label">notes</label>
            <textarea value={jobData.notes} onChange={(e) => setJobData({ ...jobData, notes: e.target.value })} className="form-textarea" rows="3" placeholder="any special instructions or notes..." />
          </div>
          <div className="modal-actions">
            <button type="button" onClick={onClose} className="btn btn-secondary">Cancel</button>
            <button type="submit" className="btn btn-primary">Create Customer & Job</button>
          </div>
        </form>
      </div>
    </div>
  );
};

const NewJobModal = ({ 
  isOpen, 
  onClose, 
  customers, 
  properties,
  onCreateJob 
}) => {
  const [jobData, setJobData] = useState({
    customerId: '',
    propertyId: '',
    serviceType: 'Mowing',
    bidType: 'bid',
    rate: '',
    hourlyRate: '75',
    estimatedHours: '1',
    propertySqft: '',
    scheduledDate: new Date().toISOString().split('T')[0],
    serviceFrequency: 'Weekly',
    notes: '',
    useExistingAddress: true,
    newAddress: ''
  });

  const currentRate = useMemo(() => {
    if (jobData.bidType === 'hourly') {
      return parseFloat(jobData.hourlyRate) * parseFloat(jobData.estimatedHours);
    }
    return parseFloat(jobData.rate) || 0;
  }, [jobData.bidType, jobData.rate, jobData.hourlyRate, jobData.estimatedHours]);

  const customerProperties = useMemo(() => {
    if (!jobData.customerId) return [];
    const customerNumber = parseInt(jobData.customerId.split('-')[1]);
    return properties.filter(p => p.customerNumber === customerNumber);
  }, [jobData.customerId, properties]);

  const selectedProperty = useMemo(() => {
    return properties.find(p => p.propertyId === jobData.propertyId);
  }, [jobData.propertyId, properties]);

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    
    // Validate required fields
    if (!jobData.customerId || !jobData.scheduledDate) {
      alert('Please select a customer and scheduled date');
      return;
    }

    // If using a new address, ensure it's provided
    if (!jobData.useExistingAddress && !jobData.newAddress) {
      alert('Please enter a service address');
      return;
    }

    // Prepare job data
    const finalJobData = {
      ...jobData,
      rate: jobData.bidType === 'hourly' 
        ? parseFloat(jobData.hourlyRate) * parseFloat(jobData.estimatedHours)
        : parseFloat(jobData.rate),
      manHours: jobData.bidType === 'hourly' ? parseFloat(jobData.estimatedHours) : 0,
      serviceAddress: jobData.useExistingAddress 
        ? selectedProperty?.serviceAddress 
        : jobData.newAddress,
      // Include propertyId only if using existing property
      propertyId: jobData.useExistingAddress ? jobData.propertyId : null
    };

    onCreateJob(finalJobData);
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <h2>Create New Job</h2>
        </div>
        <form onSubmit={handleSubmit} className="modal-form">
          <div>
            <label className="form-label">Customer</label>
            <select 
              value={jobData.customerId} 
              onChange={(e) => setJobData({...jobData, customerId: e.target.value, propertyId: ''})}
              className="form-select"
              required
            >
              <option value="">Select Customer</option>
              {customers.map(customer => (
                <option key={customer.customerId} value={customer.customerId}>
                  {customer.firstName} {customer.lastName} ({customer.customerId})
                </option>
              ))}
            </select>
          </div>

          {jobData.customerId && (
            <>
              <div>
                <label className="form-label">Property</label>
                <div className="property-selection">
                  <select
                    value={jobData.propertyId || ''}
                    onChange={(e) => setJobData({
                      ...jobData, 
                      propertyId: e.target.value,
                      useExistingAddress: true
                    })}
                    className="form-select"
                  >
                    <option value="">Select Property or Add New</option>
                    {customerProperties.map(property => (
                      <option key={property.propertyId} value={property.propertyId}>
                        {property.serviceAddress}
                      </option>
                    ))}
                    <option value="new">+ Add New Property</option>
                  </select>
                </div>
              </div>

              {(jobData.propertyId === 'new' || !jobData.propertyId) && (
                <div>
                  <label className="form-label">Service Address</label>
                  <input
                    type="text"
                    value={jobData.newAddress}
                    onChange={(e) => setJobData({
                      ...jobData, 
                      newAddress: e.target.value,
                      useExistingAddress: false
                    })}
                    className="form-input"
                    placeholder="Enter service address"
                    required
                  />
                </div>
              )}
            </>
          )}

          <div className="form-grid">
            <div>
              <label className="form-label">Service Type</label>
              <select 
                value={jobData.serviceType} 
                onChange={(e) => setJobData({...jobData, serviceType: e.target.value})}
                className="form-select"
              >
                <option value="First Time Mowing">First time Mowing</option>
                <option value="Bag Haul">Bag Haul</option>
                <option value="Mowing">Mowing</option>
                <option value="Spring Cleanup">Spring cleanup</option>
                <option value="Spring Fertilizer">Spring Fertilizer</option>
                <option value="Spring Lime">Spring Lime</option>
                <option value="Summer Fertilizer">Summer Fertilizer</option>
                <option value="Fall Fertilizer">Spring Fertilizer</option>
                <option value="Fall Lime">Spring Lime</option>
                <option value="Leaf Removal">Leaf removal</option>
                <option value="Snow Removal">Snow removal</option>
                <option value="Misc">Miscellaneous</option>
              </select>
            </div>
            <div>
              <label className="form-label">Scheduled Date</label>
              <input 
                type="date" 
                value={jobData.scheduledDate} 
                onChange={(e) => setJobData({...jobData, scheduledDate: e.target.value})}
                className="form-input" 
                required 
              />
            </div>
            <div>
              <label className="form-label">Pricing Type</label>
              <select 
                value={jobData.bidType} 
                onChange={(e) => setJobData({...jobData, bidType: e.target.value})}
                className="form-select"
              >
                <option value="bid">Bid</option>
                <option value="hourly">Hourly</option>
              </select>
            </div>
            
            {jobData.bidType === 'bid' ? (
              <div>
                <label className="form-label">Bid Amount ($)</label>
                <input 
                  type="number" 
                  step="0.01" 
                  value={jobData.rate} 
                  onChange={(e) => setJobData({...jobData, rate: e.target.value})}
                  className="form-input" 
                  placeholder="75.00" 
                  required 
                />
              </div>
            ) : (
              <>
                <div>
                  <label className="form-label">Hourly Rate ($)</label>
                  <input 
                    type="number" 
                    step="0.01" 
                    value={jobData.hourlyRate} 
                    onChange={(e) => setJobData({...jobData, hourlyRate: e.target.value})}
                    className="form-input" 
                    required 
                  />
                </div>
                <div>
                  <label className="form-label">Estimated Hours</label>
                  <input 
                    type="number" 
                    step="0.5" 
                    value={jobData.estimatedHours} 
                    onChange={(e) => setJobData({...jobData, estimatedHours: e.target.value})}
                    className="form-input" 
                    required 
                  />
                </div>
                <div>
                  <label className="form-label">Total ($)</label>
                  <div className="form-display-field">{formatCurrency(currentRate)}</div>
                </div>
              </>
            )}
            
            <div>
              <label className="form-label">Service Frequency</label>
              <select 
                value={jobData.serviceFrequency} 
                onChange={(e) => setJobData({...jobData, serviceFrequency: e.target.value})}
                className="form-select"
              >
                <option value="Weekly">Weekly</option>
                <option value="Bi-Weekly">Bi-Weekly</option>
                <option value="Monthly">Monthly</option>
                <option value="One-Time">One-Time</option>
                <option value="As-Needed">As-Needed</option>
              </select>
            </div>
          </div>

          <div>
            <label className="form-label">Notes</label>
            <textarea 
              value={jobData.notes} 
              onChange={(e) => setJobData({...jobData, notes: e.target.value})}
              className="form-textarea" 
              rows="3" 
              placeholder="Any special instructions or notes..." 
            />
          </div>

          <div className="modal-actions">
            <button type="button" onClick={onClose} className="btn btn-secondary">Cancel</button>
            <button type="submit" className="btn btn-primary">Create Job</button>
          </div>
        </form>
      </div>
    </div>
  );
};

const EditJobModal = ({ 
  isOpen, 
  onClose, 
  job, 
  onSave,
  isRecurring, 
  initialEditScope = 'single'
}) => {
  const [editScope, setEditScope] = useState('single');
  const [editedJob, setEditedJob] = useState(job);

  useEffect(() => {
    setEditedJob(job);
    setEditScope(initialEditScope)
  }, [job, initialEditScope]);

  if (!isOpen) return null;

const handleSubmit = async (e) => {
  e.preventDefault();

  const bidType = (editedJob?.bidType || 'bid').toLowerCase();
  const normalized = {
    ...editedJob,
    rate: bidType === 'hourly'
      ? Number(editedJob?.hourlyRate || 0) * Number(editedJob?.manHours || 0)
      : Number(editedJob?.rate || 0),
    hourlyRate: bidType === 'hourly' ? Number(editedJob?.hourlyRate || 0) : null,
    manHours: Number(editedJob?.manHours || 0),
  };

  const success = await onSave(normalized, editScope);
  if (success) onClose();
};

  return (
    <div className="modal-overlay job-modal">
      <div className="modal-content">
        <div className="modal-header">
          <h2>{isRecurring && editScope === 'series' ? 'Edit Job Series' : 'Edit Job'}</h2>
        </div>
        
        <form onSubmit={handleSubmit} className="modal-form">
          {isRecurring && (
            <div className="alert alert-info">
              <RefreshCw size={16} />
              <span>Editing the entire series will update all future jobs.</span>
            </div>
          )}
          
          <div className="form-group">
            <label>Pricing Type</label>
            <select
              value={(editedJob?.bidType || 'bid')}
              onChange={(e) => {
                const bidType = e.target.value;
                setEditedJob(prev => ({
                  ...prev,
                  bidType,
                  // keep previous values; no implicit recalcs here
                }));
              }}
              className="form-select"
            >
              <option value="bid">Bid</option>
              <option value="hourly">Hourly</option>
            </select>
          </div>

          {(editedJob?.bidType || 'bid') === 'bid' ? (
  <div className="form-group">
    <label>Flat Rate ($)</label>
    <input
      type="number"
      step="0.01"
      value={editedJob?.rate ?? 0}
      onChange={(e) => setEditedJob({...editedJob, rate: e.target.value })}
      className="form-input"
    />
  </div>
) : (
  <>
    <div className="form-group">
      <label>Hourly Rate ($)</label>
      <input
        type="number"
        step="0.01"
        value={editedJob?.hourlyRate ?? 0}
        onChange={(e) => setEditedJob({...editedJob, hourlyRate: e.target.value })}
        className="form-input"
      />
    </div>
    <div className="form-group">
      <label>Man Hours</label>
      <input
        type="number"
        step="0.1"
        value={editedJob?.manHours ?? 0}
        onChange={(e) => setEditedJob({...editedJob, manHours: e.target.value })}
        className="form-input"
      />
    </div>
    <div className="form-display-field">
      total (preview): {formatCurrency(((Number(editedJob?.hourlyRate)||0) * (Number(editedJob?.manHours)||0)))}
    </div>
  </>
)}

          
          <div className="form-group">
            <label>Scheduled Date</label>
            <input
              type="date"
              value={editedJob?.scheduledDate || ''}
              onChange={(e) => setEditedJob({...editedJob, scheduledDate: e.target.value})}
              className="form-input"
            />
          </div>
          
          {isRecurring && (
            <div className="form-group">
              <label>Edit Scope</label>
              <div className="radio-group">
                <label className="radio-option">
                  <input
                    type="radio"
                    checked={editScope === 'single'}
                    onChange={() => setEditScope('single')}
                  />
                  <span>Only this job</span>
                </label>
                <label className="radio-option">
                  <input
                    type="radio"
                    checked={editScope === 'series'}
                    onChange={() => setEditScope('series')}
                  />
                  <span>This and all future jobs</span>
                </label>
              </div>
            </div>
          )}
          
          <div className="modal-actions">
            <button 
              type="button" 
              onClick={onClose} 
              className="btn btn-secondary"
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const OperationMessageModal = ({ isOpen, message, isError, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content message-modal">
        <div className={`message-header ${isError ? 'error' : 'success'}`}>
          {isError ? (
            <AlertCircle size={24} />
          ) : (
            <CheckCircle size={24} />
          )}
          <h3>{isError ? 'Error' : 'Success'}</h3>
          <button className="modal-close" onClick={onClose} type="button">
           <CloseIcon size={18} />
         </button>
        </div>
        <div className="message-body">
          <p>{message}</p>
          <button 
            onClick={onClose}
            className={`btn ${isError ? 'btn-error' : 'btn-primary'}`}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
};

const EditCustomerModal = ({ isOpen, onClose, customer, onSave }) => {
  const [editedCustomer, setEditedCustomer] = useState(customer || {});

  useEffect(() => {
    setEditedCustomer(customer || {});
  }, [customer]);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    const success = await onSave(editedCustomer);
    if (success) onClose();
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <h2>edit customer</h2>
        </div>
        
        <form onSubmit={handleSubmit} className="modal-form">
          <div className="form-grid">
            <div>
              <label className="form-label">first name</label>
              <input
                type="text"
                value={editedCustomer.firstName || ''}
                onChange={(e) => setEditedCustomer({...editedCustomer, firstName: e.target.value})}
                className="form-input"
                required
              />
            </div>
            <div>
              <label className="form-label">last name</label>
              <input
                type="text"
                value={editedCustomer.lastName || ''}
                onChange={(e) => setEditedCustomer({...editedCustomer, lastName: e.target.value})}
                className="form-input"
                required
              />
            </div>
          </div>
          
          <div>
            <label className="form-label">phone number</label>
            <input
              type="tel"
              value={editedCustomer.phoneNumber || ''}
              onChange={(e) => setEditedCustomer({...editedCustomer, phoneNumber: e.target.value})}
              className="form-input"
              required
            />
          </div>
          
          <div>
            <label className="form-label">email</label>
            <input
              type="email"
              value={editedCustomer.email || ''}
              onChange={(e) => setEditedCustomer({...editedCustomer, email: e.target.value})}
              className="form-input"
            />
          </div>
          
          <div className="modal-actions">
            <button type="button" onClick={onClose} className="btn btn-secondary">
              cancel
            </button>
            <button type="submit" className="btn btn-primary">
              save changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const EditPropertyModal = ({ isOpen, onClose, property, onSave }) => {
  const [editedProperty, setEditedProperty] = useState(property || {});

   const sqftPerDollar = useMemo(() => {
    const sqft = parseFloat(editedProperty.propertySqft) || 0;
    const rate = parseFloat(editedProperty.rate) || 0;
    return rate > 0 ? (sqft / rate).toFixed(2) : '0.00';
  }, [editedProperty.propertySqft, editedProperty.rate]);

  useEffect(() => {
    setEditedProperty(property || {});
  }, [property]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const success = await onSave(editedProperty);
    if (success) onClose();
  };

 

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <h2>edit property</h2>
        </div>
        
        <form onSubmit={handleSubmit} className="modal-form">
          <div>
            <label className="form-label">service address</label>
            <input
              type="text"
              value={editedProperty.serviceAddress || ''}
              onChange={(e) => setEditedProperty({...editedProperty, serviceAddress: e.target.value})}
              className="form-input"
              required
            />
          </div>
          
          <div className="form-grid">
            <div>
              <label className="form-label">rate ($)</label>
              <input
                type="number"
                step="0.01"
                value={editedProperty.rate || ''}
                onChange={(e) => setEditedProperty({...editedProperty, rate: parseFloat(e.target.value) || 0})}
                className="form-input"
              />
            </div>
            <div>
              <label className="form-label">property sqft</label>
              <input
                type="number"
                value={editedProperty.propertySqft || ''}
                onChange={(e) => setEditedProperty({...editedProperty, propertySqft: parseFloat(e.target.value) || 0})}
                className="form-input"
              />
            </div>
          </div>
          
          <div className="form-grid">
            <div>
              <label className="form-label">service frequency</label>
              <select
                value={editedProperty.serviceFrequency || 'Weekly'}
                onChange={(e) => setEditedProperty({...editedProperty, serviceFrequency: e.target.value})}
                className="form-select"
              >
                <option value="Weekly">weekly</option>
                <option value="Bi-Weekly">bi-weekly</option>
                <option value="Monthly">monthly</option>
                <option value="One-Time">one-time</option>
                <option value="As-Needed">as-needed</option>
              </select>
            </div>
            <div>
              <label className="form-label">sqft per dollar</label>
              <div className="form-display-field">{sqftPerDollar}</div>
            </div>
          </div>
          
          <div>
            <label className="form-label">next service date</label>
            <input
              type="date"
              value={editedProperty.nextServiceDate || ''}
              onChange={(e) => setEditedProperty({...editedProperty, nextServiceDate: e.target.value})}
              className="form-input"
            />
          </div>
          
          <div className="modal-actions">
            <button type="button" onClick={onClose} className="btn btn-secondary">
              cancel
            </button>
            <button type="submit" className="btn btn-primary">
              save changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const SeriesViewModal = ({
  isOpen,
  onClose,
  seriesId,
  jobs,
  routing,
  onEditJob,
  onEditSeries,
  onDeleteJob,
}) => {
  if (!isOpen || !seriesId) return null;

  const seriesJobs = jobs
    .filter((j) => j.seriesId === seriesId)
    .sort((a, b) => new Date(a.scheduledDate) - new Date(b.scheduledDate));

  const routeByJobId = new Map(routing.map((r) => [r.jobId, r]));
  const base = seriesJobs[0];
  const nextUpcoming =
    seriesJobs.find((j) => new Date(j.scheduledDate) >= new Date()) || seriesJobs[0];

  const totalPlanned = seriesJobs.length;
  const avgRate =
    totalPlanned > 0
      ? seriesJobs.reduce((sum, j) => sum + Number(j.rate || j.estimatedRate || 0), 0) /
        totalPlanned
      : 0;

  const friendlyDate = (d) => d || '—';

  return (
    <div className="modal-overlay series-view">
      <div className="modal-content wide">
        {/* Header */}
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h2 style={{ margin: 0 }}>Job Series</h2>
            <span
              style={{
                fontSize: 12,
                padding: '4px 8px',
                borderRadius: 999,
                background: 'var(--chip-bg, #f3f4f6)',
                color: 'var(--chip-fg, #374151)',
              }}
            >
              {seriesId}
            </span>
          </div>
          <button className="modal-close" onClick={onClose} type="button" aria-label="Close">
            <CloseIcon size={18} />
          </button>
        </div>

        {/* Summary strip */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 12,
            padding: '12px 0 4px',
          }}
        >
          <div className="stat-row" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Calendar size={16} />
            <div>
              <div className="text-muted" style={{ fontSize: 12 }}>
                next service
              </div>
              <div style={{ fontWeight: 600 }}>
                {friendlyDate(nextUpcoming?.scheduledDate)}
              </div>
            </div>
          </div>
          <div className="stat-row" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Clock size={16} />
            <div>
              <div className="text-muted" style={{ fontSize: 12 }}>
                total occurrences
              </div>
              <div style={{ fontWeight: 600 }}>{totalPlanned}</div>
            </div>
          </div>
          <div className="stat-row" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <DollarSign size={16} />
            <div>
              <div className="text-muted" style={{ fontSize: 12 }}>
                avg rate
              </div>
              <div style={{ fontWeight: 600 }}>{formatCurrency(avgRate || 0)}</div>
            </div>
          </div>
        </div>

        {/* Table */}
        {seriesJobs.length === 0 ? (
          <div className="empty-state" style={{ marginTop: 16 }}>
            No jobs in this series yet.
          </div>
        ) : (
          <div className="table-container" style={{ marginTop: 12 }}>
            <div className="table-header">
              <div className="header-cell">date</div>
              <div className="header-cell">type</div>
              <div className="header-cell">pricing</div>
              <div className="header-cell">rate</div>
              <div className="header-cell">man hrs</div>
              <div className="header-cell">status</div>
              <div className="header-cell">route rev</div>
              <div className="header-cell">actions</div>
            </div>

            {seriesJobs.map((j) => {
              const r = routeByJobId.get(j.jobId);
              const rateNum = Number(j.rate || j.estimatedRate || 0);
              const revNum = Number(r?.revenue ?? r?.estimatedRevenue ?? 0);

              return (
                <div className="table-row" key={j.jobId}>
                  <div className="grid-cell mono">{j.scheduledDate}</div>
                  <div className="grid-cell">{j.serviceType}</div>
                  <div className="grid-cell">
                    <span
                      className="status-badge"
                      style={{
                        textTransform: 'capitalize',
                        background: 'var(--chip-bg, #f3f4f6)',
                        color: 'var(--chip-fg, #374151)',
                      }}
                    >
                      {j.bidType || 'bid'}
                    </span>
                    {j.isRecurring && (
                      <span
                        className="status-badge"
                        style={{ marginLeft: 8, gap: 6, display: 'inline-flex', alignItems: 'center' }}
                      >
                        <RefreshCw size={14} />
                        {j.serviceFrequency}
                      </span>
                    )}
                  </div>
                  <div className="grid-cell">{formatCurrency(rateNum)}</div>
                  <div className="grid-cell">{Number(j.manHours || 0).toFixed(1)}</div>
                  <div className="grid-cell">
                    <span
                      className={`status-badge status-${(j.status || 'Scheduled')
                        .toLowerCase()
                        .replace(' ', '-')}`}
                    >
                      {j.status || 'Scheduled'}
                    </span>
                  </div>
                  <div className="grid-cell">{r ? formatCurrency(revNum) : '—'}</div>

                  <div className="grid-cell actions">
                    <button
                      className="action-link"
                      title="Edit this job"
                      onClick={() => onEditJob(j)}
                    >
                      <Pencil size={14} />
                      Edit
                    </button>
                    <button
                      className="action-link"
                      title="Edit this and future jobs"
                      onClick={() => onEditSeries(j)}
                    >
                      <Edit2 size={14} />
                      Edit + Future
                    </button>
                    <button
                      className="action-danger"
                      title="Delete this occurrence"
                      onClick={() => onDeleteJob(j)}
                    >
                      <Trash2 size={14} />
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Footer */}
        <div className="modal-actions" style={{ marginTop: 16 }}>
          <button className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};


const Dashboard = () => {
  const [seriesView, setSeriesView] = useState({ open: false, seriesId: null })
  const [leads, setLeads] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [properties, setProperties] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [routing, setRouting] = useState([]);
  const [activeTab, setActiveTab] = useState('leads');
  const [modalOpen, setModalOpen] = useState(false);
  const [newJobModalOpen, setNewJobModalOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState(null);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);

  const [editCustomerModalOpen, setEditCustomerModalOpen] = useState(false);
  const [editPropertyModalOpen, setEditPropertyModalOpen] = useState(false);
  const [customerToEdit, setCustomerToEdit] = useState(null);
  const [propertyToEdit, setPropertyToEdit] = useState(null);

  const [activeMenu, setActiveMenu] = useState(null); // Tracks which job's menu is open
  const [jobToEdit, setJobToEdit] = useState(null);
  const [editScope, setEditScope] = useState('single'); // 'single' or 'series'
  const [isEditModalOpen, setEditModalOpen] = useState(false);
  const [operationMessage, setOperationMessage] = useState({
    show: false,
    text: '',
    isError: false
  });

// Load data from Firestore with real-time listeners
useEffect(() => {
  const unsubscribers = [];

  const leadsUnsub = onSnapshot(collection(db, 'leads'), async (snapshot) => {
    try {
      const leadsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        firstName: doc.data().firstName || '',
        lastName: doc.data().lastName || '',
        phoneNumber: doc.data().phoneNumber || '',
        email: doc.data().email || '',
        address: doc.data().address || '',
        status: doc.data().status || 'New'
      }));
      setLeads(prevLeads => {
        if (JSON.stringify(prevLeads) !== JSON.stringify(leadsData)) {
          return leadsData;
        }
        return prevLeads;
      });

      console.log('Attempting to fetch from Google Sheets...');
      
      // 1. First test if the endpoint is reachable
      let response;
      try {
        // Add timestamp to bypass caching
        const url = new URL('https://script.google.com/macros/s/AKfycbwXKUoplWQ9jeHf-px5zjJfTdxajb6IYPdr2H2BQWBNTsVlUbQ5N2Q4e9c-SzPunf9qhQ/exec');
        url.searchParams.append('t', Date.now());

        response = await fetch(url.toString(), {
          method: 'GET',
          mode: 'cors',
          cache: 'no-cache',
          redirect: 'follow',
          credentials: 'omit',
          headers: {
            'Content-Type': 'text/plain' // Required for Google Scripts
          }
        });

        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`);
        }

        // 2. Verify we actually got JSON back
        const responseText = await response.text();
        console.log('Raw response:', responseText);
        
        let sheetLeads;
        try {
          sheetLeads = JSON.parse(responseText);
        } catch (e) {
          throw new Error('Failed to parse JSON: ' + e.message);
        }

        if (!Array.isArray(sheetLeads)) {
          throw new Error('Expected array but got: ' + typeof sheetLeads);
        }

        console.log('Successfully fetched', sheetLeads.length, 'leads from sheet');

        // 3. Process new leads
        const existingLeadKeys = new Set(
          leadsData.map(lead => 
            `${lead.firstName?.toLowerCase()}-${lead.lastName?.toLowerCase()}-${lead.phoneNumber}`
          )
        );

        const newLeads = sheetLeads.filter(lead => {
          const leadKey = `${lead.firstName?.toLowerCase()}-${lead.lastName?.toLowerCase()}-${lead.phoneNumber}`;
          return !existingLeadKeys.has(leadKey);
        });

        console.log('Found', newLeads.length, 'new leads to import');

        if (newLeads.length > 0) {
          const batch = writeBatch(db);
          newLeads.forEach((lead, index) => {
            const leadRef = doc(collection(db, 'leads'));
            batch.set(leadRef, {
              ...lead,
              status: 'New',
              createdAt: serverTimestamp(),
              source: 'Google Sheets Import'
            });
            console.log(`Preparing to import lead ${index + 1}:`, lead.firstName, lead.lastName);
          });

          try {
            await batch.commit();
            console.log('Successfully imported', newLeads.length, 'leads');
          } catch (batchError) {
            console.error('Batch commit failed:', batchError);
            throw new Error('Failed to write to Firestore: ' + batchError.message);
          }
        } else {
          console.log('No new leads to import');
        }

      } catch (fetchError) {
        console.error('Fetch/processing error:', {
          error: fetchError,
          response: response ? {
            status: response.status,
            statusText: response.statusText,
            url: response.url
          } : 'No response received'
        });
        
        // User-friendly error notification
        setOperationMessage({
          show: true,
          text: 'Failed to sync with Google Sheets. Please check console for details.',
          isError: true
        });
      }
    } catch (outerError) {
      console.error('Unexpected error in leads processing:', outerError);
      setOperationMessage({
        show: true,
        text: 'An unexpected error occurred during Google Sheets sync.',
        isError: true
      });
    }
  });

  unsubscribers.push(leadsUnsub);

  // Keep your existing listeners for customers, properties, jobs, routing
  const customersUnsub = onSnapshot(collection(db, 'customers'), (snapshot) => {
    setCustomers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
  });
  unsubscribers.push(customersUnsub);

  const propertiesUnsub = onSnapshot(collection(db, 'properties'), (snapshot) => {
    console.log('=== PROPERTIES SNAPSHOT DEBUG ===');
    console.log('snapshot size:', snapshot.size);
    console.log('snapshot empty:', snapshot.empty);
    
    const propertiesData = snapshot.docs.map(doc => {
      const data = { id: doc.id, ...doc.data() };
      console.log('property doc:', data);
      return data;
    });
    
    console.log('final properties array:', propertiesData);
    setProperties(propertiesData);
  });
  unsubscribers.push(propertiesUnsub);

  const jobsUnsub = onSnapshot(collection(db, 'jobs'), (snapshot) => {
    setJobs(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
  });
  unsubscribers.push(jobsUnsub);

  const routingUnsub = onSnapshot(collection(db, 'routing'), (snapshot) => {
    setRouting(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
  });
  unsubscribers.push(routingUnsub);

  return () => {
    unsubscribers.forEach(unsub => unsub());
  };
}, []);

const handleJobUpdate = async (updatedJob, scope) => {
  if (!updatedJob) {
    setOperationMessage({
      show: true,
      text: 'No job data provided',
      isError: true
    });
    return false;
  }

  try {
    let jobsUpdated = 1; // Default for single job update
    const customerNumber = parseInt(updatedJob.customerId.split('-')[1]);

    if (scope === 'single') {
      // Update single job document
      await updateDoc(doc(db, 'jobs', updatedJob.jobId), {
        serviceType: updatedJob.serviceType,
        scheduledDate: updatedJob.scheduledDate,
        rate: parseFloat(updatedJob.rate || 0),
        manHours: parseFloat(updatedJob.manHours || 0),
        notes: updatedJob.notes || '',
        lastUpdated: serverTimestamp()
      });

      // Update corresponding routing entry
     const route = routing.find(r => r.jobId === updatedJob.jobId);
      if (route) {
        await updateDoc(doc(db, 'routing', route.id), {
          jobType: updatedJob.serviceType,
          revenue: Number(updatedJob.rate || 0),
          dollarsPerManHour: updatedJob.manHours > 0
            ? Number(updatedJob.rate || 0) / Number(updatedJob.manHours || 0)
            : 0,
          lastUpdated: serverTimestamp()
        });
      }

    } else {
      // Update entire series - get all future jobs in this series
      const seriesJobs = jobs
        .filter(j => j.seriesId === updatedJob.seriesId)
        .sort((a, b) => new Date(a.scheduledDate) - new Date(b.scheduledDate));
      
      const batch = writeBatch(db);
      const baseJobIndex = seriesJobs.findIndex(j => j.jobId === updatedJob.jobId);
      jobsUpdated = seriesJobs.length - baseJobIndex;
      
      // Update all future jobs in the series
      for (let i = baseJobIndex; i < seriesJobs.length; i++) {
        const job = seriesJobs[i];
        const jobRef = doc(db, 'jobs', job.jobId);
        
        batch.update(jobRef, {
          serviceType: updatedJob.serviceType,
          rate: parseFloat(updatedJob.rate || 0),
          manHours: parseFloat(updatedJob.manHours || 0),
          notes: updatedJob.notes || '',
          lastUpdated: serverTimestamp()
        });

        // Update corresponding routing entries
        const route = routing.find(r => r.jobId === job.jobId);
        if (route) {
          const routingRef = doc(db, 'routing', route.id);
          batch.update(routingRef, {
            jobType: updatedJob.serviceType,
            revenue: Number(updatedJob.rate || 0),
            dollarsPerManHour: updatedJob.manHours > 0
              ? Number(updatedJob.rate || 0) / Number(updatedJob.manHours || 0)
              : 0,
            lastUpdated: serverTimestamp()
          });
        }
      }
      
      await batch.commit();
    }

    // Show success message
    setOperationMessage({
      show: true,
      text: scope === 'single' 
        ? 'Job updated successfully!' 
        : `Updated ${jobsUpdated} jobs in the series!`,
      isError: false
    });

    return true;

  } catch (error) {
    console.error('Error updating job:', error);
    setOperationMessage({
      show: true,
      text: `Failed to update job: ${error.message}`,
      isError: true
    });
    return false;
  }
};

const pauseSeries = async (seriesId) => {
  try {
    const baseJob = jobs.find(j => j.seriesId === seriesId && j.jobId === j.baseJobId);
    if (!baseJob) {
      setOperationMessage({ show: true, text: 'series base job not found', isError: true });
      return;
    }
    await updateDoc(doc(db, 'jobs', baseJob.id), {
      seriesStatus: 'paused',
      lastUpdated: serverTimestamp()
    });
    setOperationMessage({ show: true, text: 'series paused', isError: false });
  } catch (e) {
    setOperationMessage({ show: true, text: `failed to pause: ${e.message}`, isError: true });
  }
};

const resumeSeries = async (seriesId) => {
  try {
    const baseJob = jobs.find(j => j.seriesId === seriesId && j.jobId === j.baseJobId);
    if (!baseJob) {
      setOperationMessage({ show: true, text: 'series base job not found', isError: true });
      return;
    }
    await updateDoc(doc(db, 'jobs', baseJob.id), {
      seriesStatus: 'active',
      lastUpdated: serverTimestamp()
    });
    // opportunistically fill futures
    await maintainRecurringJobs(baseJob, jobs, customers, getNextServiceDate);
    setOperationMessage({ show: true, text: 'series resumed', isError: false });
  } catch (e) {
    setOperationMessage({ show: true, text: `failed to resume: ${e.message}`, isError: true });
  }
};


const handleCustomerUpdate = async (updatedCustomer) => {
  try {
    await updateDoc(doc(db, 'customers', updatedCustomer.customerId), {
      firstName: updatedCustomer.firstName,
      lastName: updatedCustomer.lastName,
      phoneNumber: updatedCustomer.phoneNumber,
      email: updatedCustomer.email,
      lastUpdated: serverTimestamp()
    });

    setOperationMessage({
      show: true,
      text: 'customer updated successfully!',
      isError: false
    });
    return true;
  } catch (error) {
    console.error('error updating customer:', error);
    setOperationMessage({
      show: true,
      text: `failed to update customer: ${error.message}`,
      isError: true
    });
    return false;
  }
};

const handlePropertyUpdate = async (updatedProperty) => {
  try {
    await updateDoc(doc(db, 'properties', updatedProperty.propertyId), {
      serviceAddress: updatedProperty.serviceAddress,
      rate: updatedProperty.rate,
      propertySqft: updatedProperty.propertySqft,
      serviceFrequency: updatedProperty.serviceFrequency,
      nextServiceDate: updatedProperty.nextServiceDate,
      sqftPerDollar: updatedProperty.propertySqft && updatedProperty.rate 
        ? updatedProperty.propertySqft / updatedProperty.rate 
        : 0,
      lastUpdated: serverTimestamp()
    });

    setOperationMessage({
      show: true,
      text: 'property updated successfully!',
      isError: false
    });
    return true;
  } catch (error) {
    console.error('error updating property:', error);
    setOperationMessage({
      show: true,
      text: `failed to update property: ${error.message}`,
      isError: true
    });
    return false;
  }
};

  // Helper functions
  const getNextCustomerId = () => {
    const nums = customers.map(c => parseInt(c.customerId.split('-')[1]) || 0);
    const maxNum = Math.max(0, ...nums);
    return `ERLNS-${String(maxNum + 1).padStart(4, '0')}`;
  };

  const getNextPropertyId = (customerNumber) => {
    const customerProps = properties.filter(p => p.customerNumber === customerNumber);
    return `P-${customerNumber}-${customerProps.length + 1}`;
  };

const getNextJobId = () => {
  const year = new Date().getFullYear();
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 1000);
  return `J-${year}-${timestamp}-${random}`;
};

const getNextServiceDate = (scheduledDate, serviceFrequency) => {
  const date = new Date(scheduledDate);
  
  switch (serviceFrequency) {
    case 'Weekly':
      date.setDate(date.getDate() + 7);
      break;
    case 'Bi-Weekly':
      date.setDate(date.getDate() + 14); // 2 weeks
      break;
    case 'Monthly':
      date.setMonth(date.getMonth() + 1);
      break;
    default:
      return null;
  }
  
  return date.toISOString().split('T')[0];
};

const maintainJobSeries = async (completedJob, jobs, customers, routing) => {
  if (!completedJob.isRecurring) return;

  // Get all jobs in this series (sorted by date)
  const seriesJobs = jobs
    .filter(j => j.seriesId === completedJob.seriesId)
    .sort((a, b) => new Date(a.scheduledDate) - new Date(b.scheduledDate));

  // Always maintain 4 future jobs
  const TARGET_FUTURE_JOBS = 4;
  
  // Count how many future jobs already exist
  const existingFutureJobs = seriesJobs.filter(j => 
    new Date(j.scheduledDate) > new Date(completedJob.scheduledDate)
  ).length;

  // Calculate how many new jobs we need to create
  const jobsNeeded = TARGET_FUTURE_JOBS - existingFutureJobs;
  
  if (jobsNeeded > 0) {
    const customer = customers.find(c => c.customerId === completedJob.customerId);
    let lastDate = new Date(seriesJobs[seriesJobs.length - 1].scheduledDate);

    for (let i = 0; i < jobsNeeded; i++) {
      lastDate = new Date(getNextServiceDate(
        lastDate.toISOString().split('T')[0], 
        completedJob.serviceFrequency
      ));
      
      if (!lastDate) break;

      await createSingleJob({
        ...completedJob,
        scheduledDate: lastDate.toISOString().split('T')[0],
        status: 'Pending'
      }, customer, properties);
    }
  }
};

// Lead conversion

const convertLead = async (lead, jobData) => {
  try {
    const customerId = getNextCustomerId();
    const customerNumber = parseInt(customerId.split('-')[1]);

    const newCustomer = { 
      customerId, 
      firstName: lead.firstName || '', 
      lastName: lead.lastName || '', 
      phoneNumber: lead.phoneNumber || '', 
      referral: 'Website Form', 
      email: lead.email || '',
      createdAt: serverTimestamp()
    };

    const propertyId = getNextPropertyId(customerNumber);
    const newProperty = {
      propertyId,
      customerNumber,
      serviceAddress: jobData.serviceAddress || lead.address || '',
      rate: parseFloat(jobData.rate) || 0,
      propertySqft: parseFloat(jobData.propertySqft) || 0,
      sqftPerDollar: jobData.rate && jobData.propertySqft 
        ? parseFloat(jobData.propertySqft) / parseFloat(jobData.rate)
        : 0,
      nextServiceDate: jobData.scheduledDate,
      serviceFrequency: jobData.serviceFrequency || 'Weekly',
      active: true,
      createdAt: serverTimestamp()
    };

    // ✅ normalize rate logic
    const finalRate = jobData.bidType === 'hourly'
      ? parseFloat(jobData.hourlyRate) * parseFloat(jobData.estimatedHours)
      : parseFloat(jobData.rate);

    const jobId = getNextJobId();
    const newJob = {
      jobId,
      customerId,
      properties: [propertyId],
      serviceType: jobData.serviceType || 'Mowing',
      scheduledDate: jobData.scheduledDate,
      serviceFrequency: jobData.serviceFrequency || 'Weekly',
      estimatedRate: finalRate,
      actualRate: null,
      hourlyRate: jobData.bidType === 'hourly' ? parseFloat(jobData.hourlyRate) : null,
      rate: finalRate,
      manHours: jobData.manHours || 0,
      notes: jobData.notes || '',
      customerName: `${newCustomer.firstName} ${newCustomer.lastName}`.trim(),
      serviceAddress: newProperty.serviceAddress,
      status: 'Scheduled',
      bidType: jobData.bidType || 'bid',
      isRecurring: jobData.serviceFrequency !== 'One-Time' && jobData.serviceFrequency !== 'As-Needed',
      seriesStatus: 'active',
      seriesId: `series_${Date.now()}`,
      baseJobId: jobId,
      createdAt: serverTimestamp()
    };

    const routingId = `${jobData.scheduledDate}-${customerNumber}-${jobId}`;

    const newRouting = {
      id: routingId,                 
      jobId,
      date: jobData.scheduledDate,
      customerNumber,
      customerNameFirst: newCustomer.firstName,
      customerNameLast: newCustomer.lastName,
      phoneNumber: newCustomer.phoneNumber,
      serviceAddress: newProperty.serviceAddress,
      nextServiceDate: getNextServiceDate(jobData.scheduledDate, jobData.serviceFrequency),
      jobType: jobData.serviceType,
      mowingBid: jobData.serviceType === 'Mowing' ? `${finalRate}` : '',
      onSite: '',
      offSite: '',
      manHours: jobData.manHours || 0,
      bidType: jobData.bidType || 'bid',
      estimatedRevenue: finalRate,
      revenue: finalRate, // ✅ pre-fill
      dollarsPerManHour: jobData.manHours > 0 ? finalRate / jobData.manHours : 0,
      invoiceSent: 'No',
      createdAt: serverTimestamp()
    };

    const batch = writeBatch(db);
    batch.set(doc(db, 'customers', customerId), newCustomer);
    batch.set(doc(db, 'properties', propertyId), newProperty);
    batch.set(doc(db, 'jobs', jobId), newJob);
    batch.set(doc(db, 'routing', routingId), newRouting);

    if (lead.id) {
      batch.update(doc(db, 'leads', lead.id), { 
        status: 'Converted',
        convertedAt: serverTimestamp(),
        convertedToCustomerId: customerId
      });
    }

    await batch.commit();

    // future jobs if recurring
    if (newJob.isRecurring) {
      let currentDate = jobData.scheduledDate;
      const batch2 = writeBatch(db);
      for (let i = 0; i < 3; i++) {
        const nextDate = getNextServiceDate(currentDate, jobData.serviceFrequency);
        if (!nextDate) break;

        const nextJobId = getNextJobId();
        const nextRoutingId = `${nextDate}-${customerNumber}-${nextJobId}`;

        batch2.set(doc(db, 'jobs', nextJobId), {
          ...newJob,
          jobId: nextJobId,
          scheduledDate: nextDate,
          createdAt: serverTimestamp()
        });

        batch2.set(doc(db, 'routing', nextRoutingId), {
          ...newRouting,
          id: nextRoutingId,
          jobId: nextJobId,
          date: nextDate,
          createdAt: serverTimestamp()
        });


        currentDate = nextDate;
      }
      await batch2.commit();
    }

    setModalOpen(false);
    setSelectedLead(null);
    setOperationMessage({ show: true, text: 'Successfully converted lead to customer!', isError: false });
  } catch (error) {
    console.error('Error converting lead:', error);
    setOperationMessage({ show: true, text: `Error converting lead: ${error.message}`, isError: true });
  }
};


  const openConversionModal = (lead) => {
    setSelectedLead(lead);
    setModalOpen(true);
  };

  // Utility functions for job creation
const createSingleJob = async (jobData, customer, properties) => {
  const jobId = getNextJobId();
  const customerNumber = parseInt(jobData.customerId.split('-')[1]);

  let propertyId = jobData.propertyId;
  let serviceAddress = jobData.serviceAddress || '';

  if (jobData.isNewProperty && jobData.serviceAddress) {
    propertyId = getNextPropertyId(customerNumber);
    serviceAddress = jobData.serviceAddress;

    const newProperty = {
      propertyId,
      customerNumber,
      serviceAddress,
      rate: jobData.rate || 0,
      propertySqft: parseFloat(jobData.propertySqft) || 0,
      sqftPerDollar: jobData.rate && jobData.propertySqft 
        ? parseFloat(jobData.propertySqft) / parseFloat(jobData.rate) 
        : 0,
      nextServiceDate: jobData.scheduledDate,
      serviceFrequency: jobData.serviceFrequency || 'Weekly',
      active: true,
      createdAt: new Date().toISOString()
    };
    await setDoc(doc(db, 'properties', propertyId), newProperty);
  }

  // ✅ normalize rate
  const finalRate = jobData.bidType === 'hourly'
    ? parseFloat(jobData.hourlyRate) * parseFloat(jobData.estimatedHours)
    : parseFloat(jobData.rate);

  const newJob = {
    jobId,
    customerId: jobData.customerId,
    properties: propertyId ? [propertyId] : [],
    serviceType: jobData.serviceType || 'Mowing',
    scheduledDate: jobData.scheduledDate,
    serviceFrequency: jobData.serviceFrequency || 'Weekly',
    estimatedRate: finalRate,
    actualRate: null,
    hourlyRate: jobData.bidType === 'hourly' ? parseFloat(jobData.hourlyRate) : null,
    rate: finalRate,
    manHours: jobData.manHours || 0,
    notes: jobData.notes || '',
    customerName: `${customer.firstName || ''} ${customer.lastName || ''}`.trim(),
    serviceAddress,
    status: 'Scheduled',
    bidType: jobData.bidType || 'bid',
    createdAt: new Date().toISOString(),
    isRecurring: jobData.serviceFrequency !== 'One-Time' && jobData.serviceFrequency !== 'As-Needed',
    seriesStatus: 'active',
    seriesId: jobData.seriesId || `series_${Date.now()}`,
    baseJobId: jobData.baseJobId || jobId
  };

  await setDoc(doc(db, 'jobs', jobId), newJob);

   const routingId = `${jobData.scheduledDate}-${customerNumber}-${jobId}`;
  const newRouting = {
    id: routingId,
    jobId,
    date: jobData.scheduledDate,
    customerNumber,
    customerNameFirst: customer.firstName || '',
    customerNameLast: customer.lastName || '',
    phoneNumber: customer.phoneNumber || '',
    serviceAddress,
    nextServiceDate: getNextServiceDate(jobData.scheduledDate, jobData.serviceFrequency),
    jobType: jobData.serviceType,
    mowingBid: jobData.serviceType === 'Mowing' ? `${finalRate}` : '',
    onSite: '',
    offSite: '',
    manHours: jobData.manHours || 0,
    bidType: jobData.bidType || 'bid',
    estimatedRevenue: finalRate,
    revenue: finalRate, // ✅ pre-fill
    dollarsPerManHour: jobData.manHours > 0 ? finalRate / jobData.manHours : 0,
    invoiceSent: jobData.status === 'Pending' ? 'Pending' : 'No',
    createdAt: new Date().toISOString()
  };

  await setDoc(doc(db, 'routing', routingId), newRouting);

  return { jobId, seriesId: newJob.seriesId, baseJobId: newJob.baseJobId };
};


const createFutureJobs = async (baseJobData, customer, properties, maxJobs = 4) => {
  if (baseJobData.serviceFrequency === 'One-Time' || 
      baseJobData.serviceFrequency === 'As-Needed') {
    return;
  }

  let nextDate = baseJobData.scheduledDate;
  const createdJobs = [];

  for (let i = 0; i < maxJobs; i++) {
    nextDate = getNextServiceDate(nextDate, baseJobData.serviceFrequency);
    if (!nextDate) break;

    const { jobId } = await createSingleJob({
      ...baseJobData,
      scheduledDate: nextDate,
      status: 'Pending'
    }, customer, properties);

    createdJobs.push(jobId);
  }

  return createdJobs;
};

  // Create job for existing customer
const createJobForExistingCustomer = async (jobData) => {
   console.log('createJobForExistingCustomer received:', jobData);
  try {
    const customer = customers.find(c => c.customerId === jobData.customerId);
    if (!customer) throw new Error('Customer not found');

    // Create initial job
    const { seriesId, baseJobId } = await createSingleJob(jobData, customer, properties);

    // Create future jobs if recurring
    if (jobData.serviceFrequency !== 'One-Time' && jobData.serviceFrequency !== 'As-Needed') {
      const jobsToCreate = jobData.serviceFrequency === 'Bi-Weekly' ? 1 : 1;
      await createFutureJobs({
        ...jobData,
        seriesId,
        baseJobId
      }, customer, properties, 4);
    }

    setNewJobModalOpen(false);
    setOperationMessage({
      show: true,
      text: 'New job created successfully!',
      isError: false
    });
  } catch (error) {
    setOperationMessage({
      show: true,
      text: `Failed to create job: ${error.message}`,
      isError: true
    });
  }
};

  // Route editing
const handleRouteUpdate = async (routeId, field, value) => {
  try {
    const route = routing.find(r => r.id === routeId);
    if (!route) return;

    const job = jobs.find(j => j.jobId === route?.jobId);

    if (!job) return;

    const updatedData = { [field]: value };

    // If we're updating times, recompute hours/revenue
    if (field === 'onSite' || field === 'offSite') {
      const next = { ...route, [field]: value };
      const onStr = next.onSite;
      const offStr = next.offSite;

      const parseTime = (timeStr) => {
        if (!timeStr) return null;
        const [hours, minutes] = timeStr.split(':').map(Number);
        return hours * 60 + minutes;
      };

      const onMinutes = parseTime(onStr);
      const offMinutes = parseTime(offStr);

      if (onMinutes !== null && offMinutes !== null && offMinutes > onMinutes) {
        const hrs = Number(((offMinutes - onMinutes) / 60).toFixed(2));
        updatedData.manHours = hrs;

        if (String(job.bidType || '').toLowerCase() === 'hourly') {
          const rate = Number(job.hourlyRate || 0);
          updatedData.revenue = Number((rate * hrs).toFixed(2));
          updatedData.dollarsPerManHour = hrs > 0 ? Number((rate * hrs) / hrs) : 0;
        } else {
          const bidAmount = Number(job.rate || 0);
          updatedData.revenue = bidAmount; // always flat
          updatedData.dollarsPerManHour = hrs > 0
            ? Number((bidAmount / hrs).toFixed(2))
            : 0;
        }
      } else {
        // times not valid -> reset
        updatedData.manHours = 0;
        if (String(job.bidType || '').toLowerCase() === 'hourly') {
          updatedData.revenue = null;
          updatedData.dollarsPerManHour = job.hourlyRate || 0;
        } else {
          updatedData.revenue = Number(job.rate || 0);
          updatedData.dollarsPerManHour = 0;
        }
      }

      if ('revenue' in updatedData) updatedData.revenue = Number(updatedData.revenue ?? 0);
      if ('dollarsPerManHour' in updatedData) updatedData.dollarsPerManHour = Number(updatedData.dollarsPerManHour ?? 0);
      if ('manHours' in updatedData) updatedData.manHours = Number(updatedData.manHours ?? 0);
    }

    console.log('about to save updatedData:', updatedData);
    await updateDoc(doc(db, 'routing', routeId), updatedData);

    // Mark complete + spawn future jobs when invoiced
    if (field === 'invoiceSent' && value === 'Yes' && job) {
      const paused = job.seriesStatus === 'paused' || job.isPaused;
      const actualRevenue =
        updatedData.revenue !== undefined
          ? Number(updatedData.revenue)
          : Number(route.revenue ?? job.rate ?? 0);

      await updateDoc(doc(db, 'jobs', job.jobId), {
        status: 'Complete',
        completedAt: new Date().toISOString(),
        actualRate: actualRevenue
      });

      if (job.isRecurring && !paused) {
        const nextDate = getNextServiceDate(job.scheduledDate, job.serviceFrequency);
        if (nextDate) await createRecurringJobInstance(job, nextDate, customers);
        await maintainRecurringJobs(job, jobs, customers, getNextServiceDate, routing);
      }
    }
  } catch (error) {
    console.error('Error updating route:', error);
    setOperationMessage({
      show: true,
      text: `Failed to update route: ${error.message}`,
      isError: true
    });
  }
};



  // Filter routing by selected date
  const filteredRouting = useMemo(() => {
    return routing.filter(route => route.date === selectedDate);
  }, [routing, selectedDate]);

  // Analytics
  const analytics = useMemo(() => {
    const completedJobs = routing.filter(r => r.invoiceSent === 'Yes');
    const totalRevenue = completedJobs.reduce((sum, job) => sum + (Number(job.revenue ?? 0)), 0);
    const totalHours = completedJobs.reduce((sum, job) => sum + (parseFloat(job.manHours) || 0), 0);
    const avgDollarPerHour = totalHours > 0 ? totalRevenue / totalHours : 0;
    
    // Group by month for time-based analysis
    const monthlyData = {};
    completedJobs.forEach(job => {
      const date = new Date(job.date);
      const monthYear = `${date.toLocaleString('default', { month: 'short' })} ${date.getFullYear()}`;
      
      if (!monthlyData[monthYear]) {
        monthlyData[monthYear] = {
          revenue: 0,
          hours: 0,
          jobs: []
        };
      }
      
      const revenue = Number(job.revenue ?? 0);
      const hours = parseFloat(job.manHours) || 0;
      
      monthlyData[monthYear].revenue += revenue;
      monthlyData[monthYear].hours += hours;
      monthlyData[monthYear].jobs.push({
        revenue,
        hours,
        dollarsPerHour: hours > 0 ? revenue / hours : 0
      });
    });

    // Sort months chronologically
    const sortedMonths = Object.keys(monthlyData).sort((a, b) => {
      return new Date(a) - new Date(b);
    });

const timeChartData = {
  labels: sortedMonths,
  datasets: [
    {
      label: 'Revenue ($)',
      data: sortedMonths.map(month => monthlyData[month].revenue),
      borderColor: 'rgba(54, 162, 235, 1)',
      backgroundColor: 'rgba(54, 162, 235, 0.1)',
      borderWidth: 2,
      tension: 0.3,
      fill: true,
      yAxisID: 'y'
    },
    {
      label: 'Dollars per Man Hour ($)',
      data: sortedMonths.map(month => {
        const monthJobs = monthlyData[month].jobs;
        const total = monthJobs.reduce((sum, job) => sum + job.dollarsPerHour, 0);
        return monthJobs.length > 0 ? total / monthJobs.length : 0;
      }),
      borderColor: 'rgba(255, 99, 132, 1)',
      backgroundColor: 'rgba(255, 99, 132, 0.1)',
      borderWidth: 2,
      tension: 0.3,
      fill: true,
      yAxisID: 'y1'
    }
  ]
};

    return { 
      totalRevenue, 
      totalHours, 
      avgDollarPerHour, 
      activeCustomers: customers.length, 
      pendingLeads: leads.filter(l => l.status === 'New').length, 
      scheduledJobs: jobs.filter(j => j.status === 'Scheduled').length,
      timeChartData
    };
  }, [routing, customers, leads, jobs]);

  const timeChartOptions = {
    responsive: true,
    interaction: {
      mode: 'index',
      intersect: false,
    },
    plugins: {
      legend: {
        position: 'top',
      },
      tooltip: {
        callbacks: {
          label: function(context) {
            let label = context.dataset.label || '';
            if (label) {
              label += ': ';
            }
            if (context.parsed.y !== null) {
              label += formatCurrency(context.parsed.y);
            }
            return label;
          }
        }
      }
    },
    scales: {
      y: {
        type: 'linear',
        display: true,
        position: 'left',
        title: {
          display: true,
          text: 'Revenue ($)'
        },
        ticks: {
          callback: function(value) {
            return formatCurrency(value);
          }
        },
        grid: {
          drawOnChartArea: true
        }
      },
      y1: {
        type: 'linear',
        display: true,
        position: 'right',
        title: {
          display: true,
          text: 'Dollars/Hour ($)'
        },
        ticks: {
          callback: function(value) {
            return formatCurrency(value);
          }
        },
        grid: {
          drawOnChartArea: false
        }
      }
    }
  };

  // Tabs
  const tabs = [
    { id: 'leads', label: 'Leads', icon: Inbox },
    { id: 'scheduling', label: 'Scheduling', icon: Calendar },
    { id: 'customers', label: 'Customers', icon: Users },
    { id: 'properties', label: 'Properties', icon: Layers },
    { id: 'routing', label: 'Routing', icon: MapIcon },
    { id: 'analytics', label: 'Analytics', icon: TrendingUp }
  ];

  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <div className="dashboard-container">
      <header className="dashboard-header">
        <div className="container">
          <div className="header-content">
            <h1 className="header-title">Eagle River Lawn & Snow Dashboard</h1>
            <div className="header-stats">
              <div className="stat-item">
                <span>pending leads:</span>
                <span className="stat-value orange">{analytics.pendingLeads}</span>
              </div>
              <div className="stat-item">
                <span>scheduled jobs:</span>
                <span className="stat-value blue">{analytics.scheduledJobs}</span>
              </div>
            </div>
          </div>
        </div>
      </header>
      <div className="tabs-wrapper">
        <div className="container">
          {/* Hamburger button for mobile */}
          <button className="hamburger-menu" onClick={() => setIsMenuOpen(!isMenuOpen)}>
            <span className="hamburger-line"></span>
            <span className="hamburger-line"></span>
            <span className="hamburger-line"></span>
          </button>
          
          <nav className={`tabs-nav ${isMenuOpen ? 'mobile-open' : ''}`}>
            {tabs.map(tab => {
              const Icon = tab.icon;
              return (
                <button 
                  key={tab.id} 
                  onClick={() => {
                    setActiveTab(tab.id);
                    setIsMenuOpen(false); // Close menu when a tab is selected
                  }} 
                  className={`tab-button ${activeTab === tab.id ? 'active' : ''}`}
                >
                  <Icon className="icon" />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>
      </div>
      <main className="dashboard-content">
        <div className="container">
          {/* Leads Tab */}
          {activeTab === 'leads' && (
            <div className="tab-panel">
              <div className="panel-header">
                <h2 className="panel-title">Lead submissions</h2>
              </div>
              {leads.length === 0 ? (
                <div className="empty-state">no leads yet.</div>
              ) : (
                <div className="table-container">
                  <div className="responsive-table">
  {/* Header - Visible on both desktop and mobile */}
  <div className="table-header">
    <div className="header-cell">Name</div>
    <div className="header-cell">Contact</div>
    <div className="header-cell">Address</div>
    <div className="header-cell">Status</div>
    <div className="header-cell">Actions</div>
  </div>

  {/* Rows */}
  {leads.map((lead, idx) => (
    <div className="table-row leads" key={idx}>
      <div className="grid-cell">
        <span className="mobile-label">Name</span>
        {lead.firstName} {lead.lastName}
      </div>
      
      <div className="grid-cell mobile-email-dropdown">
        <span className="mobile-label">Contact</span>
        <div className="phone-number">{lead.phoneNumber}</div>
        <div className="text-muted">{lead.email}</div>
      </div>
      
      <div className="grid-cell">
        <span className="mobile-label">Address</span>
        {lead.address}
      </div>
      
      <div className="grid-cell">
        <span className="mobile-label">Status</span>
        <span className={`status-badge status-${(lead.status || 'New').toLowerCase()}`}>
          {lead.status || 'New'}
        </span>
      </div>
      
      <div className="grid-cell">
        <span className="mobile-label">Actions</span>
        {lead.status !== 'Converted' ? (
          <button 
            onClick={() => openConversionModal(lead)} 
            className="action-link"
          >
            Convert to customer
            <ChevronRight className="icon-sm" />
          </button>
        ) : (
          <span className="action-none">None</span>
        )}
      </div>
    </div>
  ))}
</div>
                </div>
              )}
            </div>
          )}

          {/* Scheduling Tab */}
         {activeTab === 'scheduling' && (
  <div className="tab-panel">
    <div className="panel-header">
      <h2 className="panel-title">Job Scheduling</h2>
      <button 
        onClick={() => setNewJobModalOpen(true)} 
        className="btn btn-primary"
      >
        <Plus className="icon-sm" /> <span>Create New Job</span>
      </button>
    </div>
    {jobs.length === 0 ? (
      <div className="empty-state">no jobs scheduled yet.</div>
    ) : (
      <div className="card-grid">
        {(() => {
          // filter to show only one job per series (the base job)
         const uniqueJobs = jobs.reduce((acc, job) => {
  if (job.isRecurring) {
    // group by series and find next incomplete job
    const seriesId = job.seriesId;
    const existingSeries = acc.find(j => j.seriesId === seriesId);
    
    if (!existingSeries) {
      // find all jobs in this series
      const seriesJobs = jobs
        .filter(j => j.seriesId === seriesId)
        .sort((a, b) => new Date(a.scheduledDate) - new Date(b.scheduledDate));
      
      // find next incomplete job
      const today = new Date().toISOString().split('T')[0];
      const nextJob = seriesJobs.find(j => 
        j.status !== 'Complete' && j.scheduledDate >= today
      ) || seriesJobs.find(j => j.status !== 'Complete');
      
      if (nextJob) {
        acc.push(nextJob);
      }
    }
  } else {
    // for non-recurring jobs, show if not complete
    if (job.status !== 'Complete') {
      acc.push(job);
    }
  }
  return acc;
}, []);

          return uniqueJobs.map(job => (
            <div key={job.jobId} className="card job-card">
              <div>
                <div className="job-card-title">{job.serviceType}</div>
                <div className="text-muted">{job.serviceAddress}</div>
                <div className="text-muted job-card-details">
                  {job.customerName} • scheduled: {job.scheduledDate}
                  {job.isRecurring && (
                    <span className="recurring-badge">
                      <RefreshCw className="icon-xs" /> {job.serviceFrequency}
                    </span>
                    
                  )}

                  {job.isRecurring && job.seriesStatus === 'paused' && (
                    <span className="recurring-badge paused">
                      PAUSED
                    </span>
                  )}
                </div>
              </div>
              
              <div className="job-card-actions">
                <span className={`status-badge status-${job.status.toLowerCase().replace(' ', '-')}`}>
                  {job.status}
                </span>
                
                {/* Menu button */}
                <div className="card-menu-container">
                  <button 
                    className="card-menu"
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveMenu(activeMenu === job.jobId ? null : job.jobId);
                    }}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="1"/>
                      <circle cx="19" cy="12" r="1"/>
                      <circle cx="5" cy="12" r="1"/>
                    </svg>
                  </button>
                  
                  {activeMenu === job.jobId && (
                    <div className="dropdown-menu">
                      <button onClick={() => {
                        setJobToEdit(job);
                        setEditScope('single');
                        setEditModalOpen(true);
                        setActiveMenu(null);
                      }}>
                        Edit This Job
                      </button>
                      <button onClick={() => {
                        setSeriesView({ open: true, seriesId: job.seriesId });
                        setActiveMenu(null);
                      }}>
                        View Series
                      </button>
                      <button onClick={async () => {
                        if (window.confirm('delete this single job occurrence?')) {
                          await deleteDoc(doc(db, 'jobs', job.id));
                          const route = routing.find(r => r.jobId === job.jobId);
                          if (route) await deleteDoc(doc(db, 'routing', route.id));
                          setActiveMenu(null);
                        }
                      }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M3 6h18"/>
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                        Delete This Job
                      </button>
                      
                      {job.isRecurring && (
                        <>
                          <div className="menu-divider"></div>
                          <button onClick={() => {
                            const baseJob = jobs.find(j => j.seriesId === job.seriesId && j.jobId === j.baseJobId);
                            setJobToEdit(baseJob || job); // fallback just in case
                            setEditScope('series');
                            setEditModalOpen(true);
                            setActiveMenu(null);
                          }}>
                            Edit Entire Series
                          </button>
                         <button onClick={async () => {
                            if (window.confirm('delete ALL jobs in this series?')) {
                              const seriesJobs = jobs.filter(j => j.seriesId === job.seriesId);
                              const batch = writeBatch(db);
                              seriesJobs.forEach(j => {
                                batch.delete(doc(db, 'jobs', j.jobId));
                                const route = routing.find(r => r.jobId === j.jobId);
                                if (route) batch.delete(doc(db, 'routing', route.id));
                              });
                              await batch.commit();
                              setActiveMenu(null);
                            }
                          }}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M3 6h18"/>
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                              <path d="M10 11v6"/>
                              <path d="M14 11v6"/>
                            </svg>
                            Delete Entire Series
                          </button>
                          <div className="menu-divider"></div>

                          {job.seriesStatus === 'paused' ? (
                            <button onClick={async () => {
                              await resumeSeries(job.seriesId);
                              setActiveMenu(null);
                            }}>
                              <RefreshCw size={16} />
                              resume series
                            </button>
                          ) : (
                            <button onClick={async () => {
                              await pauseSeries(job.seriesId);
                              setActiveMenu(null);
                            }}>
                              <RefreshCw size={16} />
                              pause series
                            </button>
                          )}

                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ));
        })()}
      </div>
    )}
  </div>
)}

          {/* Customers Tab */}
          {activeTab === 'customers' && (
            <div className="tab-panel">
              <h2 className="panel-title">Customer Management</h2>
              {customers.length === 0 ? (
                <div className="empty-state">no customers yet.</div>
              ) : (
                <div className="card-grid">
                  {customers.map(customer => {
                    const customerNumber = parseInt(customer.customerId.split('-')[1]);
                    const customerProps = properties.filter(p => p.customerNumber === customerNumber);
                    return (
                      <div key={customer.customerId} className="card customer-card">
                        <div className="customer-card-header">
    <div>
      <div className="customer-name">{customer.firstName} {customer.lastName}</div>
      <div className="customer-contact">
        <Phone className="icon-sm inline" />
        {customer.phoneNumber}
      </div>
      <div className="customer-contact">{customer.email}</div>
    </div>
    <div className="card-menu-container">
      <button 
        className="card-menu"
        onClick={(e) => {
          e.stopPropagation();
          setActiveMenu(activeMenu === customer.customerId ? null : customer.customerId);
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="1"/>
          <circle cx="19" cy="12" r="1"/>
          <circle cx="5" cy="12" r="1"/>
        </svg>
      </button>
      
      {activeMenu === customer.customerId && (
        <div className="dropdown-menu">
          <button onClick={() => {
            setCustomerToEdit(customer);
            setEditCustomerModalOpen(true);
            setActiveMenu(null);
          }}>
            <Pencil size={16} />
            edit customer
          </button>
        </div>
      )}
    </div>
  </div>
                        {customerProps.length > 0 && (
                          <div className="customer-properties">
                            <div className="properties-title">properties:</div>
                            {customerProps.map(prop => (
                              <div key={prop.propertyId} className="property-item">
                                <Home className="icon-xs inline" />
                                {prop.serviceAddress || 'No address set'}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Properties Tab */}
          {activeTab === 'properties' && (
<div className="tab-panel">
  <h2 className="panel-title">Property Management</h2>
  {properties.length === 0 ? (
    <div className="empty-state">
      <div className="empty-icon">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3 21h18M5 21V7l8-4v18M19 21V10l-8 4"/>
        </svg>
      </div>
      <div className="empty-title">no properties yet</div>
      <div className="empty-description">properties will appear here once you add them</div>
    </div>
  ) : (
    <div className="properties-grid">
      {properties.map(property => {
        const customer = customers.find(c => {
          const customerNumber = parseInt(c.customerId.split('-')[1]);
          return customerNumber === property.customerNumber;
        });
        
        const propertyJobs = jobs.filter(j => 
          j.properties?.includes(property.propertyId)
        );
        
        const avgDollarsPerHour = propertyJobs.length > 0 
          ? (propertyJobs.reduce((sum, job) => sum + ((job.rate || 0) / (job.manHours || 1)), 0) / propertyJobs.length)
          : 0;
        
        const services = [...new Set(propertyJobs.map(job => job.serviceType))];
        
        const lastService = propertyJobs.length > 0
          ? new Date(Math.max(...propertyJobs.map(j => new Date(j.scheduledDate))))
          : null;
          
        const nextService = property.nextServiceDate 
          ? new Date(property.nextServiceDate)
          : null;

        // determine status for indicator
        const getStatusClass = () => {
          if (!nextService) return '';
          const today = new Date();
          const daysDiff = Math.ceil((nextService - today) / (1000 * 60 * 60 * 24));
          if (daysDiff < 0) return 'overdue';
          if (daysDiff <= 7) return 'upcoming';
          return '';
        };

        return (
          <div className="property-card" key={property.propertyId}>
            <div className={`status-indicator ${getStatusClass()}`}></div>
            
            <div className="card-menu-container">
  <button 
    className="card-menu"
    onClick={(e) => {
      e.stopPropagation();
      setActiveMenu(activeMenu === property.propertyId ? null : property.propertyId);
    }}
  >
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="1"/>
      <circle cx="19" cy="12" r="1"/>
      <circle cx="5" cy="12" r="1"/>
    </svg>
  </button>
  
  {activeMenu === property.propertyId && (
    <div className="dropdown-menu">
      <button onClick={() => {
        setPropertyToEdit(property);
        setEditPropertyModalOpen(true);
        setActiveMenu(null);
      }}>
        <Pencil size={16} />
        edit
      </button>
    </div>
  )}
</div>

            <div className="address-section card-header">
              <h3 className="address-text">{property.serviceAddress}</h3>
              <div className="address-label">Service Address</div>
            </div>
            
            <div>
              <div className="customer-info">
                <h3>{customer ? `${customer.firstName} ${customer.lastName}` : 'unknown customer'}</h3>
                <div className="property-id">id: {property.propertyId}</div>
              </div>
            </div>

            <div className="services-section">
              <div className="address-label">services</div>
              <div className="services-list">
                {services.length > 0 ? (
                  services.map((service, i) => (
                    <span key={i} className={`service-tag ${service.toLowerCase().replace(/\s+/g, '-')}`}>
                      {service}
                    </span>
                  ))
                ) : (
                  <span className="service-tag">no services</span>
                )}
              </div>
            </div>

            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">
                  {avgDollarsPerHour > 0 ? formatCurrency(avgDollarsPerHour) : 'n/a'}
                </div>
                <div className="stat-label">avg $/hr</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">
                  {property.propertySqft ? property.propertySqft.toLocaleString() : 'n/a'}
                </div>
                <div className="stat-label">sqft</div>
              </div>
            </div>

            <div className="service-dates">
              <div className="date-item">
                <div className="date-value">
                  {lastService ? lastService.toLocaleDateString() : 'n/a'}
                </div>
                <div className="date-label">last service</div>
              </div>
              <div className="date-item">
                <div className="date-value">
                  {nextService ? nextService.toLocaleDateString() : 'n/a'}
                </div>
                <div className="date-label">next service</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  )}
</div>
          )}

          {/* Routing Tab */}
          {activeTab === 'routing' && (
            <div className="tab-panel">
              <div className="panel-header">
                <h2 className="panel-title">Daily Routing & Job Tracking</h2>
                <div className="date-filter">
                  <input 
                    type="date" 
                    value={selectedDate} 
                    onChange={(e) => setSelectedDate(e.target.value)} 
                    className="date-input"
                  />
                </div>
              </div>
              {filteredRouting.length === 0 ? (
                <div className="empty-state">
                  <MapIcon className="empty-state-icon" />
                  <p>no routes scheduled for { selectedDate }.</p>
                  <p className="text-sm">Convert a lead or create a job to add to the route.</p>
                </div>
              ) : (
             <div className="routing-container">
  <div className="routing-grid">
    {filteredRouting.map(route => {
  const routeId = route.id;
  const isCompleted = route.onSite && route.offSite;
  const needsInvoice = isCompleted && route.invoiceSent === 'No';
  
  // Find the corresponding job to determine bid type
  const job = jobs.find(j => j.jobId === route.jobId);

console.log('found job:', job);
console.log('job bidType:', job?.bidType);
console.log('job rate:', job?.rate);
console.log('job estimatedRate:', job?.estimatedRate);
console.log('job hourlyRate:', job?.hourlyRate)
  
  const isHourlyJob = job?.bidType === 'hourly';
  
  return (
    <div className={`routing-card ${isCompleted ? 'completed' : 'pending'} ${needsInvoice ? 'needs-invoice' : ''} ${isHourlyJob ? 'hourly-job' : 'bid-job'}`} key={routeId}>
      
      {/* Status indicator dot */}
      <div className="status-dot"></div>
      
      {/* Service header with job type indicator */}
      <div className="service-header">
        <div className="service-address-container">
          <div className="service-address">{route.serviceAddress}</div>
          
        </div>
        <div className="revenue-badge">
          {isHourlyJob ? (
            route.revenue != null
              ? <span><span className="badge-label">revenue:</span> {formatCurrency(route.revenue)}</span>
              : <span className="badge-placeholder">pending</span>
          ) : (
            <span><span className="badge-label">flat rate:</span> {formatCurrency(job?.rate || job?.estimatedRate || route.estimatedRevenue || 0)}</span>
          )}
        </div>

      </div>

      {/* Customer details */}
      <div className="customer-details">
        <div className="customer-name">
          {route.customerNameFirst} {route.customerNameLast}
        </div>
        <div className="services-list">
          {route.jobType ? (
            <span className={`service-tag ${route.jobType.toLowerCase().replace(/\s+/g, '-')}`}>
              {route.jobType}
            </span>
          ) : (
            <span className="service-tag">no service type specified</span>
          )}
        </div>
      </div>

      {/* Time tracking section */}
      <div className="time-section">
        <div className="time-inputs">
          <div className="time-input-group">
            <label>on site</label>
            <input
              type="time"
              value={route.onSite || ''}
              onChange={(e) => handleRouteUpdate(routeId, 'onSite', e.target.value)}
              className="cute-time-input"
            />
          </div>
          <div className="time-input-group">
            <label>off site</label>
            <input
              type="time"
              value={route.offSite || ''}
              onChange={(e) => handleRouteUpdate(routeId, 'offSite', e.target.value)}
              className="cute-time-input"
            />
          </div>
        </div>
        
        {/* Calculated values with different labels for hourly vs bid */}
        <div className="calculated-stats">
          <div className="stat-pill readonly">
            <span className="stat-value">{parseFloat(route.manHours || 0).toFixed(1)}</span>
            <span className="stat-label">hrs</span>
          </div>
          <div className="stat-pill readonly">
            <span className="stat-value">
              {isHourlyJob
                ? formatCurrency(route.dollarsPerManHour || job?.hourlyRate || 0)
                : formatCurrency(route.dollarsPerManHour || 0)
              }
            </span>
            <span className="stat-label">
              {isHourlyJob ? 'rate' : '/hr'}
            </span>
          </div>
        </div>
      </div>

      {/* Invoice status */}
      <div className="invoice-section">
        <label className="invoice-label">invoice status</label>
        <select
          value={route.invoiceSent || 'No'}
          onChange={(e) => handleRouteUpdate(routeId, 'invoiceSent', e.target.value)}
          className={`cute-select ${route.invoiceSent === 'Yes' ? 'sent' : 'pending'}`}
        >
          <option value="No">pending</option>
          <option value="Yes">sent</option>
        </select>
      </div>

    </div>
  );
})}
  </div>
</div>
              )}
            </div>
          )}

          {/* Analytics Tab */}
          {activeTab === 'analytics' && (
            <div className="tab-panel">
              <h2 className="panel-title">Business Analytics</h2>
              <div className="analytics-grid">
                <div className="analytics-card">
                  <div className="analytics-card-content">
                    <div>
                      <p className="analytics-label">Total Revenue</p>
                      <p className="analytics-value">{formatCurrency(analytics.totalRevenue)}</p>
                    </div>
                    <DollarSign className="analytics-icon green" />
                  </div>
                </div>
                <div className="analytics-card">
                  <div className="analytics-card-content">
                    <div>
                      <p className="analytics-label">avg $/man hour</p>
                      <p className="analytics-value">{formatCurrency(analytics.avgDollarPerHour)}</p>
                    </div>
                    <Clock className="analytics-icon blue" />
                  </div>
                </div>
                <div className="analytics-card">
                  <div className="analytics-card-content">
                    <div>
                      <p className="analytics-label">active customers</p>
                      <p className="analytics-value">{analytics.activeCustomers}</p>
                    </div>
                    <Users className="analytics-icon purple" />
                  </div>
                </div>
              </div>

              <div className="chart-container">
              <h3>Revenue & Efficiency Over Time</h3>
              <div className="chart-wrapper">
                <Line data={analytics.timeChartData} options={timeChartOptions} />
              </div>
            </div>

              <div className="quick-stats-card">
                <h3>quick stats</h3>
                <div className="stats-list">
                  <div className="stat-row">
                    <span>total man hours</span>
                    <span>{analytics.totalHours.toFixed(1)}</span>
                  </div>
                  <div className="stat-row">
                    <span>pending leads</span>
                    <span>{analytics.pendingLeads}</span>
                  </div>
                  <div className="stat-row">
                    <span>scheduled jobs</span>
                    <span>{analytics.scheduledJobs}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
      
      {/* Modals */}
      <JobCreationModal
        isOpen={modalOpen}
        onClose={() => { setModalOpen(false); setSelectedLead(null); }}
        lead={selectedLead || {}}
        onConfirm={(jobData) => convertLead(selectedLead, jobData)}
      />
      
      <NewJobModal
        isOpen={newJobModalOpen}
        onClose={() => setNewJobModalOpen(false)}
        customers={customers}
        properties={properties}
        onCreateJob={createJobForExistingCustomer}
      />

      {/* Edit Job Modal */}
      <EditJobModal
        isOpen={isEditModalOpen}
        onClose={() => {
          setEditModalOpen(false);
          setJobToEdit(null);
        }}
        job={jobToEdit}
        isRecurring={jobToEdit?.isRecurring || false}
        initialEditScope={editScope}
        onSave={handleJobUpdate}
      />

   <SeriesViewModal
   isOpen={seriesView.open}
   onClose={() => setSeriesView({ open:false, seriesId:null })}
   seriesId={seriesView.seriesId}
   jobs={jobs}
   routing={routing}
   onEditJob={(j) => { setJobToEdit(j); setEditScope('single'); setEditModalOpen(true); }}
   onEditSeries={(j) => { setJobToEdit(j); setEditScope('series'); setEditModalOpen(true); }}
   onDeleteJob={async (j) => {
     if (!window.confirm('delete this single job occurrence?')) return;
     await deleteDoc(doc(db,'jobs', j.jobId));
     const route = routing.find(r => r.jobId === j.jobId);
     if (route) await deleteDoc(doc(db,'routing', route.id));
   }}
 />

      <OperationMessageModal
        isOpen={operationMessage.show}
        message={operationMessage.text}
        isError={operationMessage.isError}
        onClose={() => setOperationMessage({ show: false, text: '', isError: false })}
      />

      <EditCustomerModal
  isOpen={editCustomerModalOpen}
  onClose={() => {
    setEditCustomerModalOpen(false);
    setCustomerToEdit(null);
  }}
  customer={customerToEdit}
  onSave={handleCustomerUpdate}
/>

<EditPropertyModal
  isOpen={editPropertyModalOpen}
  onClose={() => {
    setEditPropertyModalOpen(false);
    setPropertyToEdit(null);
  }}
  property={propertyToEdit}
  onSave={handlePropertyUpdate}
/>
    </div>
  );
};

export default Dashboard;
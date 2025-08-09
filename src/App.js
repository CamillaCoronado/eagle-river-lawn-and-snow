import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from './firebaseConfig';
import { 
  collection, 
  doc, 
  setDoc, 
  onSnapshot,
  updateDoc,
  deleteDoc,
  writeBatch,  // Add this
  serverTimestamp 
} from 'firebase/firestore';
import React, { useState, useEffect, useMemo } from 'react';
import { Calendar, Users, TrendingUp, Map, Inbox, ChevronRight, Phone, DollarSign, Clock, Home, Plus, Layers } from 'lucide-react';
import { Chart as ChartJS, registerables } from 'chart.js';
import { Line } from 'react-chartjs-2'; 
import './App.css';

ChartJS.register(...registerables);

// Helper functions
const formatCurrency = (value) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value);
};

// Modal Components
const JobCreationModal = ({ isOpen, onClose, lead, onConfirm }) => {
  const [jobData, setJobData] = useState({
    serviceType: 'Mowing',
    bidType: 'bid',
    rate: '',
    hourlyRate: '75',
    estimatedHours: '1',
    propertySqft: '',
    scheduledDate: new Date().toISOString().split('T')[0],
    serviceFrequency: 'Weekly',
    serviceAddress: lead?.address || '',
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
    onConfirm({ ...jobData, rate: finalRate, manHours: manHours });
    setJobData({ serviceType: 'Mowing', bidType: 'bid', rate: '', hourlyRate: '75', estimatedHours: '1', propertySqft: '', scheduledDate: new Date().toISOString().split('T')[0], serviceFrequency: 'Weekly', serviceAddress: '', notes: '' });
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <h2>convert lead to customer</h2>
          <p>{lead?.firstName} {lead?.lastName}</p>
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
                <option value="Mowing">mowing</option>
                <option value="Spring Cleanup">spring cleanup</option>
                <option value="Spring Fertilizer">Spring Fertilizer</option>
                <option value="Spring Lime">Spring Lime</option>
                <option value="Summer Fertilizer">Summer Fertilizer</option>
                <option value="Fall Fertilizer">Spring Fertilizer</option>
                <option value="Fall Lime">Spring Lime</option>
                <option value="Leaf Removal">leaf removal</option>
                <option value="Fall Cleanup">fall cleanup</option>
                <option value="Snow Removal">snow removal</option>
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

// In the handleSubmit function of NewJobModal:
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
                <option value="Mowing">Mowing</option>
                <option value="Snow Removal">Snow Removal</option>
                <option value="Leaf Removal">Leaf Removal</option>
                <option value="Spring Cleanup">Spring Cleanup</option>
                <option value="Fall Cleanup">Fall Cleanup</option>
                <option value="Other">Other</option>
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

// Main Dashboard Component
const Dashboard = () => {
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

// Load data from Firestore with real-time listeners
useEffect(() => {
  const unsubscribers = [];

  const leadsUnsub = onSnapshot(collection(db, 'leads'), async (snapshot) => {
    try {
      const leadsData = snapshot.docs.map(doc => ({ 
        id: doc.id, 
        ...doc.data() 
      }));
      setLeads(leadsData);

      console.log('Attempting to fetch from Google Sheets...');
      
      // 1. First test if the endpoint is reachable
      let response;
      try {
        // Add timestamp to bypass caching
        const url = new URL('https://script.google.com/macros/s/AKfycbwXKUoplWQ9jeHf-px5zjJfTdxajb6IYPdr2H2BQWBNTsVlUbQ5N2Q4e9c-SzPunf9qhQ/exec');
        url.searchParams.append('t', Date.now());

        response = await fetch(url.toString(), {
          method: 'GET',
          mode: 'cors', // Changed from 'no-cors'
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
            `${lead.firstName?.toLowerCase()}-${lead.lastName?.toLowerCase()}-${lead.phoneNumber?.toLowerCase()}`
          )
        );

        const newLeads = sheetLeads.filter(lead => {
          const leadKey = `${lead.firstName?.toLowerCase()}-${lead.lastName?.toLowerCase()}-${lead.phoneNumber?.toLowerCase()}`;
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
        alert('Failed to sync with Google Sheets. Please check console for details.');
      }
    } catch (outerError) {
      console.error('Unexpected error in leads processing:', outerError);
      alert('An unexpected error occurred. Please try again later.');
    }
  });

  unsubscribers.push(leadsUnsub);

  const customersUnsub = onSnapshot(collection(db, 'customers'), (snapshot) => {
  setCustomers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
});
  unsubscribers.push(customersUnsub);

  const propertiesUnsub = onSnapshot(collection(db, 'properties'), (snapshot) => {
    setProperties(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
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
    const yearJobs = jobs.filter(j => j.jobId?.startsWith(`J-${year}`));
    return `J-${year}-${String(yearJobs.length + 1).padStart(4, '0')}`;
  };

  const getNextServiceDate = (scheduledDate, serviceFrequency) => {
    const date = new Date(scheduledDate);
    if (serviceFrequency === 'Weekly') date.setDate(date.getDate() + 7);
    else if (serviceFrequency === 'Bi-Weekly') date.setDate(date.getDate() + 14);
    else if (serviceFrequency === 'Monthly') date.setMonth(date.getMonth() + 1);
    else return null;
    return date.toISOString().split('T')[0];
  };

  // Lead conversion
// In your convertLead function, update this part:
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
      createdAt: new Date().toISOString()
    };
    
    const propertyId = getNextPropertyId(customerNumber);
    const newProperty = { 
      propertyId, 
      customerNumber, 
      serviceAddress: lead.address || '', 
      rate: jobData.rate, 
      propertySqft: parseFloat(jobData.propertySqft) || 0, 
      sqftPerDollar: jobData.rate && jobData.propertySqft ? parseFloat(jobData.propertySqft) / parseFloat(jobData.rate) : 0, 
      nextServiceDate: jobData.scheduledDate, 
      serviceFrequency: jobData.serviceFrequency, 
      active: true,
      createdAt: new Date().toISOString()
    };
    
    const jobId = getNextJobId();
    const newJob = { 
      customerId, 
      properties: [propertyId], 
      jobId, 
      scheduledDate: jobData.scheduledDate, 
      customerName: `${newCustomer.firstName} ${newCustomer.lastName}`, 
      serviceAddress: newProperty.serviceAddress, 
      serviceType: jobData.serviceType, 
      rate: jobData.rate,
      isRecurring: jobData.serviceFrequency !== 'One-Time' && jobData.serviceFrequency !== 'As-Needed',
      // frequency: jobData.serviceFrequency,
      // seriesId: `series_${Date.now()}`, // Unique ID for this job series
      // baseJobId: jobId, // Original job ID
      // nextJobDate: getNextServiceDate(jobData.scheduledDate, jobData.serviceFrequency), 
      status: 'Scheduled', 
      notes: jobData.notes || '', 
      manHours: jobData.manHours,
      createdAt: new Date().toISOString()
    };
    
    const routingId = `${jobData.scheduledDate}-${customerNumber}`;
    const newRouting = { 
      date: jobData.scheduledDate, 
      customerNumber, 
      customerNameFirst: newCustomer.firstName, 
      customerNameLast: newCustomer.lastName, 
      phoneNumber: newCustomer.phoneNumber, 
      serviceAddress: newProperty.serviceAddress, 
      nextServiceDate: getNextServiceDate(jobData.scheduledDate, jobData.serviceFrequency), 
      jobType: jobData.serviceType, 
      mowingBid: jobData.serviceType === 'Mowing' ? `${jobData.rate}` : '', 
      onSite: '', 
      offSite: '', 
      manHours: jobData.manHours, 
      bidType: jobData.bidType, 
      revenue: `${jobData.rate}`, 
      dollarsPerManHour: jobData.manHours > 0 ? jobData.rate / jobData.manHours : 0, 
      invoiceSent: 'No',
      createdAt: new Date().toISOString()
    };

    // Write to Firestore
    await setDoc(doc(db, 'customers', customerId), newCustomer);
    await setDoc(doc(db, 'properties', propertyId), newProperty);
    await setDoc(doc(db, 'jobs', jobId), newJob);
    await setDoc(doc(db, 'routing', routingId), newRouting);
    
    // Update lead status
    if (lead.id) {
      await updateDoc(doc(db, 'leads', lead.id), { 
        status: 'Converted',
        convertedAt: new Date().toISOString(),
        convertedToCustomerId: customerId
      });
    }

    setModalOpen(false);
    setSelectedLead(null);

    // Schedule next job if recurring
    if (jobData.serviceFrequency !== 'One-Time' && jobData.serviceFrequency !== 'As-Needed') {
      const nextDate = getNextServiceDate(jobData.scheduledDate, jobData.serviceFrequency);
      if (nextDate) {
        const nextJobId = getNextJobId();
        const nextRoutingId = `${nextDate}-${customerNumber}`;
        
        const nextJob = {
          ...newJob,
          scheduledDate: nextDate,
          jobId: nextJobId
        };
        
        const nextRouting = {
          ...newRouting,
          date: nextDate,
          nextServiceDate: getNextServiceDate(nextDate, jobData.serviceFrequency)
        };
        
        await setDoc(doc(db, 'jobs', nextJobId), nextJob);
        await setDoc(doc(db, 'routing', nextRoutingId), nextRouting);
      }
    }
  } catch (error) {
    console.error('Error converting lead:', error);
    alert('Error converting lead. Please try again.');
  }
};

  const openConversionModal = (lead) => {
    setSelectedLead(lead);
    setModalOpen(true);
  };

  // Create job for existing customer
const createJobForExistingCustomer = async (jobData) => {
  try {
    const jobId = getNextJobId();
    const customer = customers.find(c => c.customerId === jobData.customerId);
    const customerNumber = parseInt(jobData.customerId.split('-')[1]);
    
    if (!customer) {
      throw new Error('Customer not found');
    }

    // Determine if we need to create a new property
    let propertyId = jobData.propertyId;
    let serviceAddress = jobData.serviceAddress;
    
    // If using a new address, create a new property
    if (!jobData.useExistingAddress && jobData.newAddress) {
      propertyId = getNextPropertyId(customerNumber);
      serviceAddress = jobData.newAddress;
      
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

    // Create the job
    const newJob = {
      customerId: jobData.customerId,
      properties: [propertyId].filter(Boolean), // Only include if propertyId exists
      jobId,
      serviceType: jobData.serviceType || 'Mowing',
      scheduledDate: jobData.scheduledDate,
      serviceFrequency: jobData.serviceFrequency || 'Weekly',
      rate: jobData.rate || 0,
      manHours: jobData.manHours || 0,
      notes: jobData.notes || '',
      customerName: `${customer.firstName || ''} ${customer.lastName || ''}`.trim(),
      serviceAddress,
      status: 'Scheduled',
      bidType: jobData.bidType || 'bid',
      createdAt: new Date().toISOString()
    };

    // Create routing entry
    const newRouting = {
      date: newJob.scheduledDate,
      customerNumber,
      customerNameFirst: customer.firstName || '',
      customerNameLast: customer.lastName || '',
      phoneNumber: customer.phoneNumber || '',
      serviceAddress,
      nextServiceDate: getNextServiceDate(newJob.scheduledDate, newJob.serviceFrequency),
      jobType: newJob.serviceType,
      mowingBid: newJob.serviceType === 'Mowing' ? `${newJob.rate}` : '',
      onSite: '',
      offSite: '',
      manHours: newJob.manHours,
      bidType: newJob.bidType,
      revenue: `${newJob.rate}`,
      dollarsPerManHour: newJob.manHours > 0 ? newJob.rate / newJob.manHours : 0,
      invoiceSent: 'No',
      createdAt: new Date().toISOString()
    };

    // Write to Firestore
    await setDoc(doc(db, 'jobs', jobId), newJob);
    await setDoc(doc(db, 'routing', `${newJob.scheduledDate}-${customerNumber}`), newRouting);
    
    setNewJobModalOpen(false);

    // Schedule next job if recurring
    if (newJob.serviceFrequency !== 'One-Time' && newJob.serviceFrequency !== 'As-Needed') {
      const nextDate = getNextServiceDate(newJob.scheduledDate, newJob.serviceFrequency);
      if (nextDate) {
        const nextJobId = getNextJobId();
        const nextJob = {
          ...newJob,
          scheduledDate: nextDate,
          jobId: nextJobId
        };
        const nextRouting = {
          ...newRouting,
          date: nextDate,
          nextServiceDate: getNextServiceDate(nextDate, newJob.serviceFrequency)
        };
        
        await setDoc(doc(db, 'jobs', nextJobId), nextJob);
        await setDoc(doc(db, 'routing', `${nextDate}-${customerNumber}`), nextRouting);
      }
    }
  } catch (error) {
    console.error('Error creating job:', error);
    alert(`Error creating job: ${error.message}`);
  }
};

  // Route editing
  const handleRouteUpdate = async (routeId, field, value) => {
  try {
    const route = routing.find(r => `${r.date}-${r.customerNumber}` === routeId);
    if (!route) return;

    const updatedData = { [field]: value };
    
    // Recalculate manHours if time fields changed
    if (field === 'onSite' || field === 'offSite') {
      const onSiteTime = new Date(`1970-01-01T${field === 'onSite' ? value : route.onSite}`);
      const offSiteTime = new Date(`1970-01-01T${field === 'offSite' ? value : route.offSite}`);
      
      if (!isNaN(onSiteTime) && !isNaN(offSiteTime) && offSiteTime > onSiteTime) {
        const diffMs = offSiteTime - onSiteTime;
        const manHours = diffMs / (1000 * 60 * 60);
        updatedData.manHours = manHours;
        
        // Recalculate dollars per man hour
        const revenue = parseFloat(route.revenue) || 0;
        updatedData.dollarsPerManHour = manHours > 0 ? revenue / manHours : 0;
      }
    }
    
    // Update in Firestore
    await updateDoc(doc(db, 'routing', routeId), updatedData);
  } catch (error) {
    console.error('Error updating route:', error);
  }
};

  // Filter routing by selected date
  const filteredRouting = useMemo(() => {
    return routing.filter(route => route.date === selectedDate);
  }, [routing, selectedDate]);

  // Analytics
  const analytics = useMemo(() => {
    const completedJobs = routing.filter(r => r.invoiceSent === 'Yes');
    const totalRevenue = completedJobs.reduce((sum, job) => sum + (parseFloat(job.revenue?.replace(/[$,]/g, '') || 0)), 0);
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
      
      const revenue = parseFloat(job.revenue?.replace(/[$,]/g, '') || 0);
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

    // Prepare chart data
    // Prepare chart data
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

  // Chart options
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
    { id: 'routing', label: 'Routing', icon: Map },
    { id: 'analytics', label: 'Analytics', icon: TrendingUp }
  ];

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
          <nav className="tabs-nav">
            {tabs.map(tab => {
              const Icon = tab.icon;
              return (
                <button 
                  key={tab.id} 
                  onClick={() => setActiveTab(tab.id)} 
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
    <div className="table-row" key={idx}>
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
                <h2 className="panel-title">job scheduling</h2>
                <button 
                  onClick={() => setNewJobModalOpen(true)} 
                  className="btn btn-primary"
                >
                  <Plus className="icon-sm" /> Create New Job
                </button>
              </div>
              {jobs.length === 0 ? (
                <div className="empty-state">no jobs scheduled yet.</div>
              ) : (
                <div className="card-grid">
                  {jobs.map(job => (
                    <div key={job.jobId} className="card job-card">
                      <div>
                        <div className="job-card-title">{job.customerName}</div>
                        <div className="text-muted">{job.serviceAddress}</div>
                        <div className="text-muted job-card-details">
                          {job.serviceType} • scheduled: {job.scheduledDate}
                        </div>
                        {job.serviceFrequency && job.serviceFrequency !== 'One-Time' && job.serviceFrequency !== 'As-Needed' && (
                          <div className="text-muted">Frequency: {job.serviceFrequency}</div>
                        )}
                      </div>
                      <div className="job-card-actions">
                        <span className={`status-badge status-${job.status.toLowerCase().replace(' ', '-')}`}>
                          {job.status}
                        </span>
                        <button className="icon-button">
                          <Calendar className="icon-md" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Customers Tab */}
          {activeTab === 'customers' && (
            <div className="tab-panel">
              <h2 className="panel-title">customer management</h2>
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
                          <div className="text-muted">ID: {customer.customerId}</div>
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
              <h2 className="panel-title">property management</h2>
              {properties.length === 0 ? (
                <div className="empty-state">no properties yet.</div>
              ) : (
                <div className="table-container">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Customer</th>
                        <th>Address</th>
                        <th>Service Frequency</th>
                        <th>Rate</th>
                        <th>Sqft</th>
                        <th>Sqft/$</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {properties.map(property => {
                        const customer = customers.find(c => {
                          const customerNumber = parseInt(c.customerId.split('-')[1]);
                          return customerNumber === property.customerNumber;
                        });
                        return (
                          <tr key={property.propertyId}>
                            <td>
                              {customer ? `${customer.firstName} ${customer.lastName}` : 'Unknown Customer'}
                              <div className="text-muted">ID: {property.propertyId}</div>
                            </td>
                            <td>{property.serviceAddress}</td>
                            <td>{property.serviceFrequency}</td>
                            <td>{formatCurrency(property.rate)}</td>
                            <td>{property.propertySqft || 'N/A'}</td>
                            <td>{property.sqftPerDollar?.toFixed(2) || 'N/A'}</td>
                            <td>
                              <span className={`status-badge status-${property.active ? 'active' : 'inactive'}`}>
                                {property.active ? 'Active' : 'Inactive'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
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
                  <label>Select Date:</label>
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
                  <Map className="empty-state-icon" />
                  <p>no routes scheduled for {new Date(selectedDate).toLocaleDateString()}.</p>
                  <p className="text-sm">Convert a lead or create a job to add to the route.</p>
                </div>
              ) : (
                <div className="table-container">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>customer</th>
                        <th>on site</th>
                        <th>off site</th>
                        <th>man hrs</th>
                        <th>$/hr</th>
                        <th>revenue</th>
                        <th>invoice sent</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRouting.map(route => {
                        const routeId = `${route.date}-${route.customerNumber}`;
                        return (
                          <tr key={routeId}>
                            <td>
                              <div>{route.customerNameFirst} {route.customerNameLast}</div>
                              <div className="text-muted">{route.serviceAddress}</div>
                              <div className="text-muted">{route.jobType}</div>
                            </td>
                            <td>
                              <input 
                                type="time" 
                                value={route.onSite || ''} 
                                onChange={(e) => handleRouteUpdate(routeId, 'onSite', e.target.value)}
                                className="table-input-time"
                              />
                            </td>
                            <td>
                              <input 
                                type="time" 
                                value={route.offSite || ''} 
                                onChange={(e) => handleRouteUpdate(routeId, 'offSite', e.target.value)}
                                className="table-input-time"
                              />
                            </td>
                            <td>{parseFloat(route.manHours || 0).toFixed(2)}</td>
                            <td>{formatCurrency(route.dollarsPerManHour || 0)}</td>
                            <td>{formatCurrency(route.revenue || 0)}</td>
                            <td>
                              <select 
                                value={route.invoiceSent || 'No'} 
                                onChange={(e) => handleRouteUpdate(routeId, 'invoiceSent', e.target.value)}
                                className="table-select"
                              >
                                <option value="No">No</option>
                                <option value="Yes">Yes</option>
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Analytics Tab */}
          {activeTab === 'analytics' && (
            <div className="tab-panel">
              <h2 className="panel-title">business analytics</h2>
              <div className="analytics-grid">
                <div className="analytics-card">
                  <div className="analytics-card-content">
                    <div>
                      <p className="analytics-label">total revenue</p>
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
  <div className="chart-wrapper" style={{ height: '400px' }}>
    <Line data={analytics.timeChartData} options={timeChartOptions} />
  </div>
  <p className="chart-note">Blue line shows monthly revenue, red line shows average dollars earned per man hour</p>
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
    </div>
  );
};

export default Dashboard;
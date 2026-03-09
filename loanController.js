export const getOverdueLoans = async (req, res) => {
    try {
        const { state, district, startDate, endDate } = req.query;

        const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

        const customerMatch = {
            "customer.isDeleted": { $ne: true },
        };

        if (district) {
            const safeDistrict = escapeRegex(district);
            customerMatch.$or = [
                { "customer.currentAddress.city": { $regex: safeDistrict, $options: "i" } },
                { "customer.aadhaarResponse.aadhaar_xml_data.address.dist": { $regex: safeDistrict, $options: "i" } },
                { "customer.aadhaarResponse.response.address.district": { $regex: safeDistrict, $options: "i" } },
            ];
        } else if (state) {
            const safeState = escapeRegex(state);
            customerMatch.$or = [
                { "customer.currentAddress.state": { $regex: safeState, $options: "i" } },
                { "customer.aadhaarResponse.aadhaar_xml_data.address.state": { $regex: safeState, $options: "i" } },
                { "customer.aadhaarResponse.response.address.state": { $regex: safeState, $options: "i" } },
            ];
        }

        const loanMatch = {
            isDeleted: false,
            status: "OVERDUE",
        };

        if (startDate || endDate) {
            loanMatch.disbursementDate = {};
            if (startDate) loanMatch.disbursementDate.$gte = new Date(startDate + "T00:00:00+05:30");
            if (endDate) loanMatch.disbursementDate.$lte = new Date(endDate + "T23:59:59.999+05:30");
        }

        const basePipeline = [
            {
                $match: loanMatch,
            },

            { $sort: { dpd: -1, totalOutstanding: -1 } },

            {
                $lookup: {
                    from: "customers",
                    localField: "customerId",
                    foreignField: "_id",
                    as: "customer",
                },
            },

            { $unwind: "$customer" },

            { $match: customerMatch },

            {
                $project: {
                    loanNumber: 1,
                    loanStatus: "$status",
                    dpd: 1,
                    dpdBucket: 1,
                    principalAmount: 1,
                    totalOutstanding: 1,
                    disbursementDate: 1,
                    nextDueDate: 1,
                    maturityDate: 1,

                    customerId: "$customer._id",
                    customerUniqueId: "$customer.customerUniqueId",
                    customerName: "$customer.fullName",
                    customerMobile: "$customer.mobile",
                    customerEmail: "$customer.email",

                    customerFullAddress: "$customer.currentAddress.fullAddress",
                    customerCity: "$customer.currentAddress.city",
                    customerState: "$customer.currentAddress.state",
                    customerPincode: "$customer.currentAddress.pincode",

                    kycStatus: "$customer.kycStatus",
                    riskCategory: "$customer.riskCategory",
                },
            },
        ];

        // ===== CSV EXPORT =====
        const loans = await LoanModel.aggregate(basePipeline).allowDiskUse(true);

        if (!loans.length) {
            return res.status(200).json({
                success: false,
                message: "No overdue data to export",
            });
        }

        const formatDate = (date) => {
            if (!date) return "";
            return new Date(date).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "medium" });
        };

        const exportData = loans.map((loan) => ({
            "Loan Number": loan.loanNumber || "",
            "Customer ID": loan.customerUniqueId || "",
            "Customer Name": loan.customerName || "",
            "Mobile": loan.customerMobile || "",
            "Email": loan.customerEmail || "",
            "Full Address": loan.customerFullAddress || "",
            "City": loan.customerCity || "",
            "State": loan.customerState || "",
            "Pincode": loan.customerPincode || "",
            "Loan Status": loan.loanStatus || "",
            "DPD": loan.dpd || 0,
            "DPD Bucket": loan.dpdBucket || "",
            "Principal Amount": loan.principalAmount || 0,
            "Total Outstanding": loan.totalOutstanding || 0,
            "Disbursement Date": formatDate(loan.disbursementDate),
            "Next Due Date": formatDate(loan.nextDueDate),
            "Maturity Date": formatDate(loan.maturityDate),
            "KYC Status": loan.kycStatus || "",
            "Risk Category": loan.riskCategory || "",
        }));

        const headers = Object.keys(exportData[0]);

        const csvRows = [
            headers.join(","),
            ...exportData.map((row) =>
                headers
                    .map((header) => {
                        const value = row[header];
                        if (typeof value === "string" && (value.includes(",") || value.includes('"') || value.includes("\n"))) {
                            return `"${value.replace(/"/g, '""')}"`;
                        }
                        return value;
                    })
                    .join(",")
            ),
        ];

        const csvContent = csvRows.join("\n");
        const filename = `overdue_loans_export_${new Date().toISOString().split("T")[0]}.csv`;

        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

        return res.status(200).send(csvContent);
    } catch (error) {
        console.error("Get overdue loans error:", error?.message, error?.code, error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch overdue loans",
            error: error?.message || "Internal server error",
        });
    }
};



// =====================================================
// EXPORT BUREAU FORMAT (Credit Bureau CSV)
// =====================================================
export const exportBureauFormat = async (req, res) => {
    try {
        let { search, status, startDate, endDate } = req.query;

        // ===== Filters =====
        let filters = { isDeleted: { $ne: true } };

        if (status) filters.status = status.toUpperCase();

        if (startDate || endDate) {
            filters.disbursementDate = {};
            if (startDate) filters.disbursementDate.$gte = new Date(startDate + "T00:00:00+05:30");
            if (endDate) filters.disbursementDate.$lte = new Date(endDate + "T23:59:59.999+05:30");
        }

        // ===== Search =====
        if (search) {
            const searchRegex = new RegExp(search, "i");
            const matchedCustomers = await CustomerModel.find({
                $or: [
                    { fullName: searchRegex },
                    { mobile: searchRegex },
                    { customerUniqueId: searchRegex },
                ],
            }).select("_id").lean();

            const customerIds = matchedCustomers.map(c => c._id);
            filters.$or = [
                { loanNumber: searchRegex },
                { customerId: { $in: customerIds } },
            ];
        }

        // ===== Fetch Loans with Customer data =====
        const loans = await LoanModel.find(filters)
            .sort({ createdAt: -1 })
            .populate({
                path: "customerId",
                select: "fullName panCard dateOfBirth gender mobile email currentAddress",
            })
            .lean();

        if (!loans.length) {
            return res.status(200).json({ success: false, message: "No data to export" });
        }

        // ===== Date formatter (DD-MM-YYYY) =====
        const formatDate = (date) => {
            if (!date) return "";
            const d = new Date(date);
            const day = String(d.getDate()).padStart(2, "0");
            const month = String(d.getMonth() + 1).padStart(2, "0");
            const year = d.getFullYear();
            return `${day}-${month}-${year}`;
        };

        // ===== Gender code =====
        const genderCode = (gender) => {
            if (!gender) return "";
            const g = gender.toUpperCase();
            if (g === "MALE") return "1";
            if (g === "FEMALE") return "2";
            if (g === "OTHER") return "3";
            return "";
        };

        // ===== Account status code (bureau standard) =====
        const accountStatusCode = (loan) => {
            const s = loan.status?.toUpperCase();
            if (s === "CLOSED") return "13";
            if (s === "SETTLED") return "14";
            if (s === "WRITTEN_OFF") return "15";
            if (s === "NPA") return "16";
            if ((loan.dpd || 0) > 0) return "11";  // Overdue
            if (s === "ACTIVE") return "11";
            return "11";
        };

        // ===== Payment frequency code =====
        const paymentFrequency = (type) => {
            if (!type) return "B";
            const t = type.toUpperCase();
            if (t === "MONTHLY") return "M";
            if (t === "WEEKLY") return "W";
            return "B"; // Bullet/Single
        };

        // ===== Last payment date from schedule =====
        const getLastPaymentDate = (schedule) => {
            if (!Array.isArray(schedule) || !schedule.length) return "";
            const paidEMIs = schedule
                .filter(s => s.paidDate && (s.status === "PAID" || s.status === "PARTIALLY_PAID"))
                .sort((a, b) => new Date(b.paidDate) - new Date(a.paidDate));
            return paidEMIs.length > 0 ? formatDate(paidEMIs[0].paidDate) : "";
        };

        // ===== Overdue amount from schedule =====
        const getAmountOverdue = (schedule) => {
            if (!Array.isArray(schedule) || !schedule.length) return 0;
            return schedule
                .filter(s => s.status === "OVERDUE")
                .reduce((sum, s) => sum + ((s.totalDue || s.emiAmount || 0) - (s.paidAmount || 0)), 0);
        };

        // ===== Build export data =====
        const exportData = loans.map(loan => {
            const customer = loan.customerId || {};
            const addr = customer.currentAddress || {};

            return {
                "Account Number": loan.loanNumber || "",
                "Customer Name": customer.fullName || "",
                "PAN Number": customer.panCard || "",
                "Date of Birth": formatDate(customer.dateOfBirth),
                "Gender": genderCode(customer.gender),
                "Phone": customer.mobile || "",
                "Email": customer.email || "",
                "Address Line 1": addr.line1 || addr.fullAddress || "",
                "Address Line 2": addr.line2 || "",
                "City": addr.city || "",
                "State": addr.state || "",
                "Pincode": addr.pincode || "",
                "Account Type": "05",
                "Ownership Indicator": "1",
                "Date Opened": formatDate(loan.disbursementDate),
                "Date of Last Payment": getLastPaymentDate(loan.schedule),
                "Date Closed": formatDate(loan.closureDate),
                "Date Reported": formatDate(new Date()),
                "High Credit/Sanctioned Amount": loan.principalAmount || 0,
                "Current Balance": loan.totalOutstanding || 0,
                "Amount Overdue": getAmountOverdue(loan.schedule),
                "Days Past Due": loan.dpd || 0,
                "Account Status": accountStatusCode(loan),
                "Payment Frequency": paymentFrequency(loan.repaymentType),
                "Actual Payment Amount": loan.emiAmount || 0,
                "Tenure": loan.tenure || 0,
            };
        });

        // ===== Generate CSV =====
        const headers = Object.keys(exportData[0]);
        const csvRows = [
            headers.join(","),
            ...exportData.map(row =>
                headers.map(header => {
                    const value = row[header];
                    if (typeof value === "string" && (value.includes(",") || value.includes('"') || value.includes("\n"))) {
                        return `"${value.replace(/"/g, '""')}"`;
                    }
                    return value;
                }).join(",")
            )
        ];

        const csvContent = csvRows.join("\n");
        const filename = `bureau_export_${new Date().toISOString().split("T")[0]}.csv`;

        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

        return res.status(200).send(csvContent);

    } catch (error) {
        console.error("Bureau format export error:", error);
        return res.status(500).json({
            success: false,
            message: error.message || "Internal server error",
        });
    }
};




// =====================================================
// MANUAL LOAN RECALCULATION (DPD + Late Charges + Outstanding)
// =====================================================
export const reCalculationOfLoan = async (req, res) => {
    try {
        const { loanNumbers } = req.body;

        if (!Array.isArray(loanNumbers) || loanNumbers.length === 0) {
            return res.status(400).json({ success: false, message: "loanNumbers must be a non-empty array" });
        }

        if (loanNumbers.length > 500) {
            return res.status(400).json({ success: false, message: "Maximum 500 loan numbers allowed per request" });
        }

        const loans = await LoanModel.find({
            loanNumber: { $in: loanNumbers },
            isDeleted: { $ne: true }
        });

        if (!loans.length) {
            return res.status(404).json({ success: false, message: "No loans found" });
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const sanitize = (v) => (isNaN(v) || v === null || v === undefined) ? 0 : v;

        const getDPDBucket = (dpd) => {
            if (dpd <= 0) return "0";
            if (dpd <= 30) return "1-30";
            if (dpd <= 60) return "31-60";
            if (dpd <= 90) return "61-90";
            return "90+";
        };

        const results = [];

        for (const loan of loans) {
            try {
                const schedule = loan.schedule?.[0];
                if (!schedule) {
                    results.push({ loanNumber: loan.loanNumber, success: false, message: "No schedule found" });
                    continue;
                }

                // ===== BEFORE snapshot =====
                const before = {
                    dpd: loan.dpd,
                    dpdBucket: loan.dpdBucket,
                    status: loan.status,
                    lateCharges: loan.lateCharges,
                    lateChargeInterest: loan.lateChargeInterest,
                    lateChargesOutstanding: loan.lateChargesOutstanding,
                    lateChargeInterestOutstanding: loan.lateChargeInterestOutstanding,
                    principalOutstanding: loan.principalOutstanding,
                    interestOutstanding: loan.interestOutstanding,
                    totalOutstanding: loan.totalOutstanding,
                    totalRepayment: loan.totalRepayment,
                };

                // ===== STEP 1: Fresh DPD from maturityDate =====
                const dueDate = new Date(loan.maturityDate || loan.nextDueDate);
                dueDate.setHours(0, 0, 0, 0);

                const dpd = Math.max(0, Math.floor((today - dueDate) / 86400000));

                // ===== STEP 2: Fresh Late Charges (penalty starts from DPD 4) =====
                const lateChargesPerDay = sanitize(loan.lateChargesPerDay) || 0;
                const penaltyDays = Math.max(0, dpd - 3);
                const lateCharges = penaltyDays * lateChargesPerDay;

                // ===== STEP 3: Fresh Late Charge Interest =====
                const principalAmount = sanitize(loan.principalAmount);
                const interestRate = sanitize(loan.interestRate);
                const lateChargeInterest = dpd > 0
                    ? ((principalAmount * interestRate) / 100) * dpd
                    : 0;

                // ===== STEP 4: Calculate total paid from schedule =====
                const allSchedules = loan.schedule || [];
                const totalPaid = allSchedules.reduce((sum, emi) => sum + sanitize(emi.paidAmount), 0);

                // ===== STEP 5: Recalculate all amounts =====
                const totalInterest = sanitize(loan.totalInterest);
                const baseLoanAmount = principalAmount + totalInterest;
                const newTotalRepayment = baseLoanAmount + lateCharges + lateChargeInterest;
                const totalOutstanding = Math.max(0, newTotalRepayment - totalPaid);

                // Break down outstanding (payment priority: lateCharges → lateChargeInterest → interest → principal)
                let remaining = totalPaid;

                // 1. Pay late charges first
                const lateChargesPaid = Math.min(remaining, lateCharges);
                remaining -= lateChargesPaid;
                const lateChargesOutstanding = Math.max(0, lateCharges - lateChargesPaid);

                // 2. Pay late charge interest
                const lateChargeInterestPaid = Math.min(remaining, lateChargeInterest);
                remaining -= lateChargeInterestPaid;
                const lateChargeInterestOutstanding = Math.max(0, lateChargeInterest - lateChargeInterestPaid);

                // 3. Pay interest
                const interestPaid = Math.min(remaining, totalInterest);
                remaining -= interestPaid;
                const interestOutstanding = Math.max(0, totalInterest - interestPaid);

                // 4. Pay principal
                const principalPaid = Math.min(remaining, principalAmount);
                const principalOutstanding = Math.max(0, principalAmount - principalPaid);

                // ===== STEP 6: DPD bucket + status =====
                let newStatus;
                const dpdBucket = getDPDBucket(dpd);

                if (totalOutstanding <= 0) {
                    newStatus = "CLOSED";
                } else if (dpd > 90) {
                    newStatus = "NPA";
                } else if (dpd > 0) {
                    newStatus = "OVERDUE";
                } else {
                    newStatus = "ACTIVE";
                }

                // ===== STEP 7: Update schedule[0] =====
                schedule.lateCharges = lateCharges;
                schedule.totalDue = sanitize(schedule.emiAmount) + lateCharges + lateChargeInterest;
                schedule.balance = Math.max(0, schedule.totalDue - sanitize(schedule.paidAmount));

                if (totalOutstanding <= 0) {
                    schedule.status = "PAID";
                } else if (sanitize(schedule.paidAmount) > 0) {
                    schedule.status = "PARTIALLY_PAID";
                } else if (dpd > 0) {
                    schedule.status = "OVERDUE";
                } else {
                    schedule.status = "PENDING";
                }

                // ===== STEP 8: Apply all updates =====
                loan.dpd = dpd;
                loan.dpdBucket = dpdBucket;
                loan.status = newStatus;
                loan.lateCharges = lateCharges;
                loan.lateChargeInterest = lateChargeInterest;
                loan.lateChargesOutstanding = lateChargesOutstanding;
                loan.lateChargeInterestOutstanding = lateChargeInterestOutstanding;
                loan.principalOutstanding = principalOutstanding;
                loan.interestOutstanding = interestOutstanding;
                loan.totalOutstanding = totalOutstanding;
                loan.totalRepayment = newTotalRepayment;
                loan.lateChargesDate = today;

                if (newStatus === "NPA" && !loan.npaDate) {
                    loan.npaDate = today;
                }
                if (newStatus === "CLOSED" && !loan.closureDate) {
                    loan.closureDate = today;
                }

                await loan.save();

                // ===== AFTER snapshot =====
                results.push({
                    loanNumber: loan.loanNumber,
                    success: true,
                    before,
                    after: {
                        dpd,
                        dpdBucket,
                        status: newStatus,
                        lateCharges,
                        lateChargeInterest: Math.round(lateChargeInterest * 100) / 100,
                        lateChargesOutstanding,
                        lateChargeInterestOutstanding: Math.round(lateChargeInterestOutstanding * 100) / 100,
                        principalOutstanding,
                        interestOutstanding,
                        totalOutstanding: Math.round(totalOutstanding * 100) / 100,
                        totalRepayment: Math.round(newTotalRepayment * 100) / 100,
                    },
                    totalPaid,
                    penaltyDays,
                });

            } catch (err) {
                results.push({ loanNumber: loan.loanNumber, success: false, message: err.message });
            }
        }

        const successCount = results.filter(r => r.success).length;

        return res.status(200).json({
            success: true,
            message: `Recalculated ${successCount}/${loans.length} loans`,
            data: results,
            recalculatedAt: new Date(),
        });

    } catch (error) {
        console.error("recalculateLoan error:", error);
        return res.status(500).json({
            success: false,
            message: error.message || "Internal server error",
        });
    }
};


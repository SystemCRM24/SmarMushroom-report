BX24.init(() => {
    const BX24W = new BX24Wrapper();
    const dealFieldMap = {
        productionEnd: "UF_CRM_1770212738813",
    };

    const usersData = {};
    const domain = (new URLSearchParams(window.location.search)).get('DOMAIN');

    const loader = $('#loader');
    const tableContainer = $('#table-container');
    const tableBody = $('#table-body');
    const totalAmountEl = $('#total-amount');

    const showLoading = () => loader.removeClass('d-none');
    const hideLoading = () => loader.addClass('d-none');
    const showTable = () => tableContainer.removeClass('d-none');
    const hideTable = () => tableContainer.addClass('d-none');

    function clearTable() {
        tableBody.empty();
        totalAmountEl.text("");
    }

    $('#responsible-select').selectize({
        plugins: ["remove_button"],
        multi: true,
        maxItems: null,
        searchField: 'name',
        placeholder: "Выберите ответственных...",
        hideSelected: true,
    });

    async function setupUsers() {
        const users = await BX24W.callMethod("user.get", {});
        const widget = $('#responsible-select')[0].selectize;
        for ( const user of users ) {
            usersData[user.LAST_NAME] = user;
            widget.addOption({value: user.LAST_NAME, text: user.LAST_NAME});
            widget.addItem(user.LAST_NAME);
        }
        hideLoading();
    }
    setupUsers();

    $('#date-range').daterangepicker({
        startDate: moment().subtract(30, 'days'),
        endDate: moment(),
        opens: 'right',
        autoUpdateInput: true,
        locale: {
            format: 'DD.MM.YYYY',
            separator: " - ",
            applyLabel: "Выбрать",
            cancelLabel: "Отмена",
            fromLabel: "От",
            toLabel: "До",
            customRangeLabel: "Свой интервал",
            daysOfWeek: ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"],
            monthNames: ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"],
            firstDay: 1
        }
    });

    function getFilterData() {
        const responsibles = new Set($('#responsible-select').val() || []);
        const drp = $('#date-range').data('daterangepicker');
        return {
            responsibles: responsibles,
            from: drp.startDate.toISOString(),
            to: drp.endDate.toISOString()
        };
    }

    $('#apply-filter').on('click', async () => {
        showLoading();
        hideTable();
        clearTable();
        const filter = getFilterData();
        const deals = await getDeals(filter);
        if ( deals.length ) {
            const [result, productRows, productRowsCalls] = await getProductRows(deals);
            await handleVariations(filter, result, productRows, productRowsCalls);
            fillTable(result);
        }
        showTable();
        hideLoading();
    })

    function getDeals(filter) {
        const params = {
            select: ['ID', 'TITLE'],
            filter: {
                [`>=${dealFieldMap.productionEnd}`]: filter.from,
                [`<=${dealFieldMap.productionEnd}`]: filter.to
            }
        }
        return BX24W.callListMethod('crm.deal.list', params);
    }

    // Формируем запрос на товарные позиции и готовим итоговый объект
    async function getProductRows(deals) {
        const result = {};
        const productRowsCalls = [];
        for ( const deal of deals ) {
            result[deal.ID] = deal;
            productRowsCalls.push(['crm.deal.productrows.get', {id: deal.ID}]);
        }
        const productRows = await BX24W.callLongBatch(productRowsCalls, false);
        return [result, productRows, productRowsCalls];
    }

    // Дальше начинается магия работы с указателями. Понимайте как хотите.
    async function handleVariations(filter, result, productRows, productRowsCalls) {
        const services = {};
        const servicesCalls = [];
        for ( const index in productRows) {
            const dealId = productRowsCalls[index][1]?.id;
            const deal = result[dealId];
            deal.services = [];
            const products = productRows[index];
            for ( const product of products) {
                const isServiceType = product.TYPE === 7;
                const managerLastName = (product.ORIGINAL_PRODUCT_NAME || "").split(' ').at(-1);
                const isCorrectResponsible = filter.responsibles.has(managerLastName);
                // Нужны только услуги и Правильные ответственные
                if ( !isServiceType || !isCorrectResponsible ) {
                    continue;
                }
                deal.services.push(product);
                if ( !Object.hasOwn(services, product.PRODUCT_ID) ) {
                    servicesCalls.push(['catalog.product.service.get', {id: product.PRODUCT_ID}]);
                    services[product.PRODUCT_ID] = [];
                }
                services[product.PRODUCT_ID].push(product);
            }
        }
        // Получаем вариации (услуги непосредственно) и разбираем их
        if ( servicesCalls.length ) {
                    const variations = await BX24W.callLongBatch(servicesCalls, false);
            for ( const line of variations ) {
                const service = line.service;
                services[service.id].forEach(p => p.parent = service);
            }
        }
    }

    function fillTable(products) {
        let result = 0;
        for ( const deal of Object.values(products) ) {
            for ( const service of deal.services ) {
                const tr = $('<tr>');

                const serviceName = service?.parent?.name || service.ORIGINAL_PRODUCT_NAME;
                const splited = serviceName.split(' ');
                
                tr.append(createTd(getUserLinkElement(splited.pop(), usersData)));
                tr.append(createTd(getDealLinkElement(deal)));
                tr.append(createTd(splited.join(" ")));

                const qty = service.QUANTITY;
                tr.append(createTd(service.QUANTITY, 'px-3'));

                const priceRub = service?.parent?.property108?.value || "0|RUB";
                const price = Number.parseFloat(priceRub);
                tr.append(createTd(price));

                const sum = price * qty;
                tr.append(createTd(sum.toFixed(2)));

                result += sum;
                tableBody.append(tr);
            }
        }
        totalAmountEl.text(result.toFixed(2));
    }

    function createTd(data, className = "text-nowrap px-3") {
        const $td = $('<td>').addClass(className);
        return $td.append(data);
    }

    function getUserLinkElement(lastName, users) {
        const user = users[lastName];
        if (user && user.ID) {
            return $('<a>', {
                href: `https://${domain}/company/personal/user/${user.ID}/`,
                target: '_blank',
                text: lastName,
                class: 'text-decoration-none fw-medium'
            });
        }
        return lastName;
    }

    function getDealLinkElement(deal) {
        return $('<a>', {
            href: `https://${domain}/crm/deal/details/${deal.ID}/`,
            target: '_blank',
            text: deal.TITLE,
            class: 'text-decoration-none fw-medium'
        });
    }
})